/**
 * 기본 양식 hwpx 회귀 검사.
 *
 * **API 를 부르지 않습니다.** 지어낸 일지 글과 1픽셀짜리 JPEG 로 파일을 짓고, 한글이 열지 못하는
 * 조건들을 코드로 봅니다. 사람 눈 확인은 `scratch-ilji.hwpx` 를 한글에서 열어 하면 됩니다.
 *
 *   npm run check:hwpx      (노드 22 이상)
 *
 * 보는 것
 *   - zip 첫 항목이 mimetype 이고 압축이 없는가
 *   - XML 이 짝이 맞는가(태그 열고 닫기)
 *   - 스타일 번호가 목록마다 빈틈없이 이어지고 itemCnt 와 같은가
 *   - 본문이 가리키는 번호가 전부 header 에 있는가
 *   - 사진 수 = 그림 채움 수 = 꾸러미 항목 수 = 목록(manifest) 수
 *   - 일지 글의 자리 나누기가 사람이 고친 글에도 그대로 되는가
 */

import { writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { buildIljiHwpx, buildWeeklyIljiHwpx } from "../src/core/hwpx/ilji.ts";
import { pickPhotos, readReportText } from "../src/core/ilji-slots.ts";
import { buildReport } from "../src/core/report.ts";

const problems = [];
let checked = 0;
function check(name, condition, detail = "") {
  checked++;
  if (condition) console.log(`OK   ${name}`);
  else problems.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

// 1×1 회색 JPEG. 사진 자리를 채우는 데만 쓴다.
const TINY_JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  ),
  (c) => c.charCodeAt(0),
);

// ── ① 지어낸 묶음으로 일지 글을 만들고, 그 글을 자리로 나눈다.
const groups = [
  { id: "a", photos: [0, 1, 2], address: "○○로12길 34", lane: "waste_cleanup", edited: false, time: "08:32" },
  { id: "b", photos: [3, 4], address: "△△로 5", lane: "waste_cleanup", edited: false, time: "08:50" },
  { id: "c", photos: [5, 6], address: "□□길 7-1", lane: "risk_facility", edited: false, time: "09:10" },
  { id: "d", photos: [7], address: "", lane: "flood_season", edited: false, time: "09:40" },
  { id: "e", photos: [8, 9], address: "◇◇로 9", lane: "unknown", edited: false, time: "" },
];
const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: ["◎◎공원 그늘막"] });
const parsed = readReportText(report.full);

check("순찰일시 줄을 읽는다", parsed.dateLabel.startsWith("2026. 5. 12.(화)"), parsed.dateLabel);
check("순찰구역 줄을 읽는다", parsed.area === "○○동 관내 전지역", parsed.area);
check("순찰사항 란에 자리 줄이 들어간다", parsed.rows.patrol.some((l) => l.includes("○○로12길 34")), parsed.rows.patrol.join(" / "));
check("첫 단계 줄머리가 칸 왼쪽에 붙는다", parsed.rows.patrol[0]?.startsWith("○ "), JSON.stringify(parsed.rows.patrol[0]));
check("둘째 단계 들여쓰기는 남는다", parsed.rows.patrol[1]?.startsWith("  - "), JSON.stringify(parsed.rows.patrol[1]));
check("위험시설물 란", parsed.rows.facility.some((l) => l.includes("□□길 7-1")), parsed.rows.facility.join(" / "));
check("계절특수 란에 고정 지점", parsed.rows.seasonal.some((l) => l.includes("◎◎공원 그늘막")), parsed.rows.seasonal.join(" / "));
check("특이사항은 비어 있다", parsed.rows.etc.length === 0, parsed.rows.etc.join(" / "));

// 사람이 고친 글. 특이사항을 적고 주민소통 란을 새로 넣었다.
check("특이사항 줄은 안 낸다", !report.full.includes("특이사항:") || !report.full.includes("※ 특이사항"), report.full.slice(-40));
const edited = report.full + "\n\n※ 특이사항: 가로등 1개 소등 확인" + "\n\n□ 주민소통\n  ○ 통장 면담 1회";
const again = readReportText(edited);
check("고친 특이사항을 읽는다", again.rows.etc[0] === "가로등 1개 소등 확인", again.rows.etc.join(" / "));
check("새로 적은 주민소통 란을 읽는다", again.rows.community[0] === "○ 통장 면담 1회", again.rows.community.join(" / "));

// ── ② 사진 고르기. 주소판은 빼고, 판정이 「전」「후」라고 본 장을 각각. 없으면 첫 장·마지막 장.
const plates = new Set([2, 4]);
const stages = { 0: ["before", 0.9], 1: ["after", 0.9], 6: ["after", 0.85] };
const stageScore = (i, stage) => (stages[i]?.[0] === stage ? stages[i][1] : 0);
const picks = pickPhotos(groups, (i) => plates.has(i), stageScore);
check("갈래 없는 자리는 사진을 안 싣는다", picks.length === 4, String(picks.length));
check("전·후를 판정대로 고른다", picks[0].before === 0 && picks[0].after === 1, JSON.stringify(picks[0]));
check("순찰사항 한 장뿐이면(주소판 제외) 후에 둔다", picks[1].before === null && picks[1].after === 3 && picks[1].pair, JSON.stringify(picks[1]));
check("다른 란은 첫 장·둘째 장을 차례로(짝 아님)", picks[2].before === 5 && picks[2].after === 6 && !picks[2].pair, JSON.stringify(picks[2]));
check("다른 란 한 장이면 첫 칸에", picks[3].before === 7 && picks[3].after === null && !picks[3].pair, JSON.stringify(picks[3]));
check("주소 없는 자리는 「주소 미기재」", picks[3].caption === "주소 미기재", picks[3].caption);

// ── ③ hwpx 를 짓고 구조를 본다.
const photos = picks.map((p, i) => ({
  caption: p.caption,
  pair: p.pair,
  before: p.before === null || i === 2 ? null : TINY_JPEG,
  after: p.after === null ? null : TINY_JPEG,
}));
const bytes = buildIljiHwpx({
  dong: "○○동",
  unit: "환경순찰",
  officer: "",
  dateLabel: parsed.dateLabel,
  area: parsed.area,
  rows: again.rows,
  counts: { patrol: 2, seasonal: 1, facility: 1 },
  photos,
});
try {
  writeFileSync("scratch-ilji.hwpx", bytes);
} catch {
  console.log(`(scratch-ilji.hwpx 을 못 썼습니다. 한글에서 열려 있으면 닫고 다시 도세요.)`);
}

const zip = unzipSync(bytes);
const names = Object.keys(zip);
check("첫 항목이 mimetype", names[0] === "mimetype", names[0]);
check("mimetype 값", strFromU8(zip.mimetype) === "application/hwp+zip");
// zip 지역 헤더의 압축 방식(offset 8, 2바이트). 첫 항목은 0(저장)이어야 한다.
check("mimetype 은 압축하지 않는다", bytes[8] === 0 && bytes[9] === 0, `${bytes[8]},${bytes[9]}`);

const header = strFromU8(zip["Contents/header.xml"]);
const section = strFromU8(zip["Contents/section0.xml"]);
const hpf = strFromU8(zip["Contents/content.hpf"]);

function wellFormed(source, name) {
  const xml = source.replace(/^<\?xml[^>]*\?>/, "");
  const stack = [];
  const re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g;
  let m;
  let pos = 0;
  while ((m = re.exec(xml))) {
    const between = xml.slice(pos, m.index);
    if (/[<]/.test(between) || /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(between)) {
      return `${name}: 글자 사이에 이스케이프 안 된 기호 (${between.slice(0, 40)})`;
    }
    pos = m.index + m[0].length;
    const [, closing, tagName, , selfClosing] = m;
    if (closing) {
      if (stack.pop() !== tagName) return `${name}: </${tagName}> 짝이 안 맞음`;
    } else if (!selfClosing) stack.push(tagName);
  }
  return stack.length === 0 ? null : `${name}: 안 닫힌 태그 ${stack.join(",")}`;
}
check("header.xml 짝이 맞는다", wellFormed(header, "header") === null, wellFormed(header, "header") ?? "");
check("section0.xml 짝이 맞는다", wellFormed(section, "section") === null, wellFormed(section, "section") ?? "");
check("content.hpf 짝이 맞는다", wellFormed(hpf, "hpf") === null, wellFormed(hpf, "hpf") ?? "");

function ids(list, item) {
  const block = new RegExp(`<hh:${list} itemCnt="(\\d+)">([\\s\\S]*?)</hh:${list}>`).exec(header);
  if (!block) return { count: -1, found: [] };
  const found = [...block[2].matchAll(new RegExp(`<hh:${item} id="(\\d+)"`, "g"))].map((x) => Number(x[1]));
  return { count: Number(block[1]), found };
}
function contiguous(found, from) {
  return found.every((id, i) => id === from + i);
}
for (const [list, item, from] of [
  ["borderFills", "borderFill", 1],
  ["charProperties", "charPr", 0],
  ["paraProperties", "paraPr", 0],
  ["styles", "style", 0],
  ["tabProperties", "tabPr", 0],
]) {
  const { count, found } = ids(list, item);
  check(`${list} 번호가 ${from} 부터 빈틈없이`, contiguous(found, from), found.join(","));
  check(`${list} itemCnt 가 실제 수와 같다`, count === found.length, `${count} vs ${found.length}`);
}

const refs = (attr) => new Set([...section.matchAll(new RegExp(`${attr}="(\\d+)"`, "g"))].map((x) => Number(x[1])));
const has = (list, item) => new Set(ids(list, item).found);
for (const [attr, list, item] of [
  ["charPrIDRef", "charProperties", "charPr"],
  ["paraPrIDRef", "paraProperties", "paraPr"],
  ["borderFillIDRef", "borderFills", "borderFill"],
]) {
  const missing = [...refs(attr)].filter((id) => !has(list, item).has(id));
  check(`본문의 ${attr} 가 전부 header 에 있다`, missing.length === 0, missing.join(","));
}

const imgFills = [...header.matchAll(/binaryItemIDRef="(\w+)"/g)].map((x) => x[1]);
const binNames = names.filter((n) => n.startsWith("BinData/"));
const manifest = [...hpf.matchAll(/<opf:item id="(img\d+)"/g)].map((x) => x[1]);
check("사진 5장 = 그림 채움 5 = BinData 5 = 목록 5", imgFills.length === 5 && binNames.length === 5 && manifest.length === 5,
  `${imgFills.length}/${binNames.length}/${manifest.length}`);
check("사진 없는 칸은 얇은 테두리로 남는다", (section.match(/borderFillIDRef="3"/g) ?? []).length > 0);
check("줄 배치 캐시를 적지 않는다", !section.includes("linesegarray"));
check("셀 크기는 전부 정수", [...section.matchAll(/<hp:cellSz width="([^"]+)" height="([^"]+)"/g)].every((m) => /^\d+$/.test(m[1]) && /^\d+$/.test(m[2])));
check("행마다 셀 너비 합 = 표 너비", (() => {
  const tables = [...section.matchAll(/<hp:tbl [^>]*>[\s\S]*?<\/hp:tbl>/g)].map((m) => m[0]);
  return tables.every((t) => {
    const width = Number(/<hp:sz width="(\d+)"/.exec(t)?.[1]);
    return [...t.matchAll(/<hp:tr>([\s\S]*?)<\/hp:tr>/g)].every((row) => {
      const sum = [...row[1].matchAll(/<hp:cellSz width="(\d+)"/g)].reduce((a, m) => a + Number(m[1]), 0);
      return sum === width;
    });
  });
})());
check("표가 6개(띠·첫 쪽 틀·자리 4)", (section.match(/<hp:tbl /g) ?? []).length === 6, String((section.match(/<hp:tbl /g) ?? []).length));
check("사진 표 머리에 주소", section.includes("□ ○○로12길 34"));
check("순찰사항은 정비 전·후, 다른 란은 현장 확인", section.includes("정비 전") && section.includes("정비 후") && section.includes("현장 확인"));
check("첫 쪽 틀도 사진 표와 같은 얇은 선(굵은 변 없음)", !header.includes('width="0.5 mm"'));
check("머리띠가 한 칸이고 개소 수가 같이 적힌다", section.includes("□ 순찰사항 · 2개소") && !section.includes("<hp:t>2개소</hp:t>"));
check("특이사항이 있으면 그 칸이 있다", section.includes("□ 특이사항"));
check("특이사항이 없으면 그 칸도 없다", !strFromU8(unzipSync(buildIljiHwpx({ dong: "○○동", unit: "", officer: "", dateLabel: "", area: "", rows: parsed.rows, photos: [] }))["Contents/section0.xml"]).includes("□ 특이사항"));
check("제목은 굵게", /<hh:charPr id="1" [^>]*>[\s\S]*?<hh:bold\/>[\s\S]*?<\/hh:charPr>/.test(header.split('<hh:charPr id="2"')[0]));
check("제목과 「동 · 부서」가 다른 칸", /<hp:t>현장 순찰 일지<\/hp:t>[\s\S]*?<\/hp:tc>[\s\S]*?<hp:t>○○동/.test(section));
check("본문 칸 높이가 글 줄 수 이상", (() => {
  const page = [...section.matchAll(/<hp:tbl [^>]*>[\s\S]*?<\/hp:tbl>/g)].map((m) => m[0])[1];
  const cells = [...page.matchAll(/<hp:tc [\s\S]*?<\/hp:tc>/g)].map((m) => m[0]);
  return cells.every((tc) => {
    const height = Number(/<hp:cellSz width="\d+" height="(\d+)"/.exec(tc)?.[1]);
    const paras = (tc.match(/<hp:p /g) ?? []).length;
    return height >= paras * 1800 || paras <= 1;
  });
})());
check("주소가 사진 표에 들어간다", section.includes("○○로12길 34"));
check("특이사항이 셀에 들어간다", section.includes("가로등 1개 소등 확인"));
check("XML 특수문자를 이스케이프한다", !/<hp:t>[^<]*&[^a#][^<]*<\/hp:t>/.test(section));

// 같은 입력이면 같은 XML.
const a = buildIljiHwpx({ dong: "○○동", unit: "", officer: "", dateLabel: "", area: "", rows: again.rows, photos: [] });
const b = buildIljiHwpx({ dong: "○○동", unit: "", officer: "", dateLabel: "", area: "", rows: again.rows, photos: [] });
const sameXml =
  strFromU8(unzipSync(a)["Contents/section0.xml"]) === strFromU8(unzipSync(b)["Contents/section0.xml"]) &&
  strFromU8(unzipSync(a)["Contents/header.xml"]) === strFromU8(unzipSync(b)["Contents/header.xml"]);
check("같은 입력이면 같은 XML", sameXml);

// ── ④ 주간. 하루치 셋을 이어 붙이면 날마다 새 쪽에서 시작하고 사진은 한 쪽(표 셋)까지만.
const daySlots = (n) => ({
  dong: "○○동", unit: "", officer: "", dateLabel: `2026. 9. ${21 + n}.`, area: "○○동 관내",
  rows: { seasonal: [], facility: [], community: [], patrol: [`○ ${n}일째`], etc: [] },
  counts: { patrol: 5 },
  photos: Array.from({ length: 5 }, (_, i) => ({ caption: `○○로${i + 1}길 ${n}`, pair: true, before: TINY_JPEG, after: TINY_JPEG })),
});
const weekly = buildWeeklyIljiHwpx([1, 2, 3].map((n) => ({ slots: daySlots(n), tag: `9월 3주차 · ${n}/5` })), "○○동 현장 순찰 일지 2026년 9월 3주차");
const wz = unzipSync(weekly);
const wsec = strFromU8(wz["Contents/section0.xml"]);
const whead = strFromU8(wz["Contents/header.xml"]);
const stripBreaks = [...wsec.matchAll(/<hp:p [^>]*pageBreak="1"[^>]*><hp:run [^>]*><hp:tbl /g)].length;
check("주간: section 짝이 맞는다", wellFormed(wsec, "week") === null, wellFormed(wsec, "week") ?? "");
check("주간: 띠 셋에 몇째 날", wsec.includes("9월 3주차 · 1/5") && wsec.includes("9월 3주차 · 2/5") && wsec.includes("9월 3주차 · 3/5"));
check("주간: 둘째 날부터 띠가 새 쪽(표 문단 pageBreak)", stripBreaks === 2, String(stripBreaks));
check("주간: 사진 쪽은 날마다 표 셋까지(15 자리 중 9)", (wsec.match(/<hp:tbl /g) ?? []).length === 3 * (2 + 3), String((wsec.match(/<hp:tbl /g) ?? []).length));
check("주간: 사진 18장 = 그림 채움 18 = BinData 18", [...whead.matchAll(/binaryItemIDRef="(\w+)"/g)].length === 18 && Object.keys(wz).filter((n) => n.startsWith("BinData/")).length === 18);
check("주간: 테두리 번호가 빈틈없이", (() => { const f = [...whead.matchAll(/<hh:borderFill id="(\d+)"/g)].map((m) => Number(m[1])); return f.every((id, i) => id === i + 1); })());
check("주간: 하루치 한 날만이면 일지와 같은 표 수", (strFromU8(unzipSync(buildWeeklyIljiHwpx([{ slots: daySlots(1), tag: "9월 3주차 · 1/5" }], "t"))["Contents/section0.xml"]).match(/<hp:tbl /g) ?? []).length === 5);

if (problems.length > 0) {
  console.error(`\n${checked - problems.length}/${checked} 통과 · 실패 ${problems.length}건`);
  for (const problem of problems) console.error(`  → ${problem}`);
  process.exit(1);
}
console.log(`\n${checked}/${checked} 통과 · scratch-ilji.hwpx 를 한글에서 열어 눈으로 확인`);
