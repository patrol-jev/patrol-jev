/**
 * 부서 양식 칸 지도·채우기 회귀 검사.
 *
 * **API 를 부르지 않습니다.** 기본 양식을 빈 채로 지어 「남의 양식」인 척 읽고, 칸 지도를 만들고,
 * 그 지도로 채운 뒤 셀 글자와 사진이 제자리에 들어갔는지 봅니다. 실물 양식은 여기 없습니다.
 *
 *   npm run check:form      (노드 22 이상)
 */

import { writeFileSync } from "node:fs";
import { strFromU8 } from "fflate";
import { mapForm } from "../src/core/form-map.ts";
import { SLOT_LABELS } from "../src/core/form-slots.ts";
import { fillForm, fillFormWeek } from "../src/core/hwpx/fill.ts";
import { buildIljiHwpx } from "../src/core/hwpx/ilji.ts";
import { openHwpx } from "../src/core/hwpx/read.ts";

const problems = [];
let checked = 0;
function check(name, condition, detail = "") {
  checked++;
  if (condition) console.log(`OK   ${name}`);
  else problems.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const TINY_JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  ),
  (c) => c.charCodeAt(0),
);

// ── ① 빈 양식. 사진 자리 넷(전·후 여덟 칸, 그림 없음), 글 칸 전부 빈 채.
const blank = buildIljiHwpx({
  dong: "○○동",
  unit: "",
  officer: "",
  dateLabel: "",
  area: "",
  // 특이사항 칸은 글이 있을 때만 생기므로, 남의 양식인 척하려고 빈 줄 하나를 둔다.
  rows: { seasonal: [], facility: [], community: [], patrol: [], etc: [""] },
  photos: [true, true, false, false].map((pair) => ({ caption: "", pair, before: null, after: null })),
});
const doc = openHwpx(blank);
check("표 6개를 읽는다", doc.tables.length === 6, String(doc.tables.length));
check("첫 쪽 틀은 14행 4열(제목 둘·개요 둘·머리띠와 본문 다섯 쌍)", doc.tables[1].rows === 14 && doc.tables[1].cols === 4);
const label = doc.tables[1].cells.find((c) => c.row === 2 && c.col === 0);
check("라벨 글자를 읽는다", label?.text === "순찰일시", label?.text);
const bar = doc.tables[1].cells.find((c) => c.row === 6 && c.col === 0);
check("머리띠 글자를 읽는다", bar?.text === "□ 계절특수 점검", JSON.stringify(bar?.text));

const map = mapForm(doc);
const slots = Object.keys(SLOT_LABELS);
check("자리 여덟을 다 잇는다", slots.every((k) => map.text[k]), `못 이음: ${map.missing.join(",")} · 갈림: ${map.ambiguous.join(",")}`);
check("순찰일시 → 틀 2행 1열", map.text.dateLabel?.tbl === 1 && map.text.dateLabel?.row === 2 && map.text.dateLabel?.col === 1, JSON.stringify(map.text.dateLabel));
check("순찰자 → 틀 2행 3열(네 칸 줄)", map.text.officer?.tbl === 1 && map.text.officer?.row === 2 && map.text.officer?.col === 3, JSON.stringify(map.text.officer));
check("계절특수 → 머리띠 아래 병합 본문(7행)", map.text.seasonal?.tbl === 1 && map.text.seasonal?.row === 7 && map.text.seasonal?.col === 0, JSON.stringify(map.text.seasonal));
check("순찰사항 → 머리띠 아래 병합 본문(5행)", map.text.patrol?.tbl === 1 && map.text.patrol?.row === 5 && map.text.patrol?.col === 0, JSON.stringify(map.text.patrol));
check("사진 자리 넷", map.photos.length === 4, String(map.photos.length));
check("자리마다 전·후 두 칸", map.photos.every((p) => p.cells.length === 2), map.photos.map((p) => p.cells.length).join(","));
check("사진 비율을 잰다", map.photoRatio > 1.5 && map.photoRatio < 1.7, String(map.photoRatio));
check("등급 A", map.grade === "A", map.grade);
check("빈 양식이라 미리 채워진 칸 없음", map.prefilled.length === 0, map.prefilled.join(","));
check("지문 12자", /^[0-9a-f]{12}$/.test(map.fingerprint), map.fingerprint);
check("라벨 원문에 값이 안 섞인다", map.labels.every((l) => l.length <= 30));

// 같은 꼴이면 같은 지문. 글자가 들어 있어도(작성본) 같은 양식이면 같다.
const filledOnce = buildIljiHwpx({
  dong: "△△동",
  unit: "환경순찰",
  officer: "동장",
  dateLabel: "2026. 5. 12.(화)",
  area: "△△동 관내",
  rows: { seasonal: ["○ 점검"], facility: [], community: [], patrol: ["○ 청소", "  - ◇◇로 1 폐기물 처리"], etc: ["없음"] },
  photos: [{ caption: "◇◇로 1", pair: true, before: TINY_JPEG, after: TINY_JPEG }, ...Array.from({ length: 3 }, () => ({ caption: "", pair: false, before: null, after: null }))],
});
const map2 = mapForm(openHwpx(filledOnce));
check("작성본도 같은 지문", map2.fingerprint === map.fingerprint, `${map.fingerprint} vs ${map2.fingerprint}`);
check("작성본은 미리 채워진 칸을 알린다", map2.prefilled.includes("patrol") && map2.prefilled.includes("dateLabel"), map2.prefilled.join(","));
check("그림이 깔린 칸도 사진 칸으로 본다", map2.photos.length === 4 && map2.photos[0].cells.length === 2, String(map2.photos.length));

// ── ② 채우기.
const filled = fillForm(blank, map, {
  dong: "○○동",
  unit: "",
  officer: "○○동장",
  dateLabel: "2026. 5. 12.(화) (08:32~09:40)",
  area: "○○동 관내 전지역",
  rows: {
    seasonal: ["○ 스마트그늘막 등 점검", "  - 현장확인: 1건"],
    facility: [],
    community: [],
    patrol: ["○ 이면도로 청소", "  - ○○로12길 34 외 1개소", "    · ○○로12길 34 폐기물 처리 & 수거"],
    etc: ["가로등 1개 소등 확인"],
  },
  photos: [
    { caption: "○○로12길 34", pair: true, before: TINY_JPEG, after: TINY_JPEG },
    { caption: "△△로 5", pair: true, before: null, after: TINY_JPEG },
    { caption: "□□길 7-1", pair: false, before: null, after: null },
  ],
});
try {
  writeFileSync("scratch-bridge.hwpx", filled.bytes);
} catch {
  console.log(`(scratch-bridge.hwpx 을 못 썼습니다. 한글에서 열려 있으면 닫고 다시 도세요.)`);
}
check("못 채운 자리 없음", filled.skipped.length === 0, filled.skipped.join(","));
check("사진 3장 넣음(전·후 + 후)", filled.photosPlaced === 3, String(filled.photosPlaced));

const out = openHwpx(filled.bytes);
const cellAt = (tbl, row, col) => out.tables[tbl].cells.find((c) => c.row === row && c.col === col);
check("순찰일시가 들어갔다", cellAt(1, 2, 1)?.text === "2026. 5. 12.(화) (08:32~09:40)", cellAt(1, 2, 1)?.text);
check("순찰자가 들어갔다", cellAt(1, 2, 3)?.text === "○○동장", cellAt(1, 2, 3)?.text);
check("순찰사항 세 줄이 문단 셋으로", cellAt(1, 5, 0)?.text.split("\n").length === 3, JSON.stringify(cellAt(1, 5, 0)?.text));
check("& 가 이스케이프돼 다시 읽힌다", cellAt(1, 5, 0)?.text.includes("처리 & 수거"), cellAt(1, 5, 0)?.text);
check("빈 란은 빈 채로", cellAt(1, 9, 0)?.text === "", JSON.stringify(cellAt(1, 9, 0)?.text));
check("특이사항", cellAt(1, 13, 0)?.text === "가로등 1개 소등 확인", cellAt(1, 13, 0)?.text);
check("머리띠 칸은 안 건드린다", cellAt(1, 4, 0)?.text === "□ 순찰사항", JSON.stringify(cellAt(1, 4, 0)?.text));
check("첫 자리 전 칸에 그림", cellAt(2, 1, 0)?.hasImage === true);
check("첫 자리 후 칸에 그림", cellAt(2, 1, 1)?.hasImage === true);
check("둘째 자리는 후만(전 칸 비움)", cellAt(3, 1, 0)?.hasImage === false && cellAt(3, 1, 1)?.hasImage === true);
check("셋째 자리는 그림 없음", cellAt(4, 1, 0)?.hasImage === false && cellAt(4, 1, 1)?.hasImage === false);
check("주소가 머리 칸에(정비 전·후 표시는 그대로)", cellAt(2, 0, 0)?.text === "○○로12길 34" && cellAt(2, 2, 0)?.text === "정비 전", `${cellAt(2, 0, 0)?.text} / ${cellAt(2, 2, 0)?.text}`);
check("셋째 자리 주소도 머리 칸에(현장 확인 표시는 그대로)", cellAt(4, 0, 0)?.text === "□□길 7-1" && cellAt(4, 2, 0)?.text === "현장 확인", `${cellAt(4, 0, 0)?.text} / ${cellAt(4, 2, 0)?.text}`);

const header = out.header;
const fills = [...header.matchAll(/<hh:borderFill id="(\d+)"/g)].map((m) => Number(m[1]));
check("테두리 번호가 1부터 빈틈없이(끝에 이어 붙임)", fills.every((id, i) => id === i + 1), fills.join(","));
check("itemCnt 가 실제 수와 같다", Number(/<hh:borderFills itemCnt="(\d+)"/.exec(header)?.[1]) === fills.length);
check("줄 배치 캐시 없음", out.sections.every((s) => !s.includes("linesegarray")));
const names = Object.keys(out.entries);
check("mimetype 이 첫 항목", names[0] === "mimetype", names[0]);
check("사진 파일이 꾸러미에", names.filter((n) => n.startsWith("BinData/pjimg")).length === 3);
check("목록(manifest)에도", (out.hpf.match(/pjimg\d+\.jpg/g) ?? []).length === 3);
check("원래 있던 그림 채움(빈 양식엔 없음)에 새 것 셋", [...header.matchAll(/binaryItemIDRef="(pjimg\d+)"/g)].length === 3);
check("mimetype 값 그대로", strFromU8(out.entries.mimetype) === "application/hwp+zip");

// ── ③ 채운 파일을 다시 양식으로 올리면(09-26 실물) 그림 이름이 겹치면 안 된다. 옛 그림이 새 그림을 덮었다.
const again = fillForm(filled.bytes, mapForm(openHwpx(filled.bytes)), {
  dong: "○○동", unit: "", officer: "", dateLabel: "2026. 5. 13.(수)", area: "○○동 관내",
  rows: { seasonal: [], facility: [], community: [], patrol: ["○ 다음 날"], etc: [] },
  photos: [{ caption: "◇◇로 2", pair: true, before: TINY_JPEG, after: TINY_JPEG }],
});
const againDoc = openHwpx(again.bytes);
const againIds = [...againDoc.hpf.matchAll(/<opf:item [^>]*id="([^"]+)"/g)].map((m) => m[1]);
check("다시 채우기: 새 그림 이름이 옛 것과 안 겹친다", againIds.filter((id, i) => againIds.indexOf(id) !== i).length === 0, againIds.join(","));
check("다시 채우기: 옛 그림 3 + 새 그림 2", Object.keys(againDoc.entries).filter((n) => n.startsWith("BinData/pjimg")).length === 5);
check("다시 채우기: 첫 자리 전·후 칸이 새 그림을 가리킨다", (() => {
  const c = againDoc.tables[2].cells.find((x) => x.row === 1 && x.col === 0);
  const fillXml = new RegExp(`<hh:borderFill id="${c.fill}"[\\s\\S]*?</hh:borderFill>`).exec(againDoc.header)?.[0] ?? "";
  return /binaryItemIDRef="pjimg[45]"/.test(fillXml);
})());
check("다시 채우기: 넘긴 자리 수와 양식 자리 수를 돌려준다", again.photosOffered === 1 && again.photoSlots === 4, `${again.photosOffered}/${again.photoSlots}`);

// ── ④ 주간. 같은 양식을 사흘치로 이어 붙이면 표가 세 벌, 구역 설정은 하나, 날짜는 셋 다.
const dayOf = (n) => ({
  dong: "○○동", unit: "", officer: "", dateLabel: `2026. 5. ${n}.(월)`, area: "○○동 관내",
  rows: { seasonal: [], facility: [], community: [], patrol: [`○ ${n}일`], etc: [] },
  photos: [{ caption: `△△로 ${n}`, pair: true, before: TINY_JPEG, after: TINY_JPEG }],
});
const week = fillFormWeek(blank, map, [dayOf(11), dayOf(12), dayOf(13)]);
const weekDoc = openHwpx(week.bytes);
const wsec = weekDoc.sections[0];
check("주간: 표가 세 벌", weekDoc.tables.length === doc.tables.length * 3, String(weekDoc.tables.length));
check("주간: 구역 설정은 하나", (wsec.match(/<hp:secPr/g) ?? []).length === 1 && (wsec.match(/<hp:colPr/g) ?? []).length === 1);
check("주간: 둘째·셋째 셋은 쪽 나눔으로 시작", (wsec.match(/pageBreak="1"/g) ?? []).length >= 2);
check("주간: 날짜 셋이 제자리에", [11, 12, 13].every((n, k) => weekDoc.tables[1 + k * doc.tables.length].cells.find((c) => c.row === 2 && c.col === 1)?.text === `2026. 5. ${n}.(월)`));
check("주간: 사진 6장", week.photosPlaced === 6 && Object.keys(weekDoc.entries).filter((n) => n.startsWith("BinData/pjimg")).length === 6);
const tblIds = [...wsec.matchAll(/<hp:tbl [^>]*id="(\d+)"/g)].map((m) => m[1]);
check("주간: 표 id 가 안 겹친다", tblIds.filter((id, i) => tblIds.indexOf(id) !== i).length === 0);
check("주간: 캐시 없음 · 짝 맞음", !wsec.includes("linesegarray") && (wsec.match(/<hp:tbl /g) ?? []).length === (wsec.match(/<\/hp:tbl>/g) ?? []).length);

// ── 결과 보고서 양식 지도·채우기. 기본 결과 보고서 양식을 「남의 양식」인 척 읽는다(제목 1×1 표와 자리 표는 없어 B).
{
  const { mapPeriodForm } = await import("../src/core/period-form-map.ts");
  const { fillPeriodForm } = await import("../src/core/hwpx/fill-period.ts");
  const { buildPeriodHwpx } = await import("../src/core/hwpx/period.ts");
  const { summarisePeriod, weekPeriod, CATEGORY_ROWS } = await import("../src/core/period.ts");
  const spot = (address, lane, work = "") => ({ address, lane, work, time: "09:00", pair: lane === "waste_cleanup", before: true, after: true });
  const days = [
    { date: "2026-05-11", dong: "○○동", photos: 6, groups: 2, report: "", spots: [spot("○○로1길 1", "waste_cleanup"), spot("○○로2길 3", "risk_facility", "확인, ※ 통보")] },
    { date: "2026-05-13", dong: "○○동", photos: 4, groups: 2, report: "", spots: [spot("○○로3길 7", "waste_cleanup"), spot("○○로4길 9", "flood_season")] },
  ];
  const summary = summarisePeriod(days, weekPeriod("2026-05-13"));
  const empty = summarisePeriod([], weekPeriod("2026-05-13"));
  const form = buildPeriodHwpx({ dong: "○○동", unit: "", officer: "", summary: empty, photos: [] });
  const map = mapPeriodForm(openHwpx(form));
  check("결과 보고서: 항목표 27줄을 전부 잇는다", Object.keys(map.categories).length === CATEGORY_ROWS.length, String(Object.keys(map.categories).length));
  check("결과 보고서: 정비요청 세부내역 표와 열", map.requests !== null && map.requests.cols.address !== undefined && map.requests.cols.text !== undefined, JSON.stringify(map.requests));
  check("결과 보고서: 자리 표가 없으면 B", map.grade === "B" && map.spots.length === 0, map.grade);
  const photos = summary.details.map((d) => ({ date: d.date, lane: d.lane, no: d.no, work: d.work, caption: d.address, note: "", pair: d.pair, before: TINY_JPEG, after: TINY_JPEG }));
  const filled = fillPeriodForm(form, map, { dong: "○○동", summary, photos });
  const out = openHwpx(filled.bytes);
  const catTable = out.tables.find((t) => t.cells.some((c) => c.row === 0 && c.text === "정비요청") && t.rows > 20);
  const cleanEtc = catTable?.cells.find((c) => c.row === 11 && c.col === 3);
  check("결과 보고서: 청소 · 기타 자체정비 칸에 2", cleanEtc?.text === "2", cleanEtc?.text);
  const riskReq = catTable?.cells.find((c) => c.row === 21 && c.col === 2);
  check("결과 보고서: 재난위험시설 정비요청 칸에 1", riskReq?.text === "1", riskReq?.text);
  const blank = catTable?.cells.find((c) => c.row === 1 && c.col === 2);
  check("결과 보고서: 셀 수 없는 줄은 빈 칸 그대로", (blank?.text ?? "") === "", blank?.text);
  check("결과 보고서: 자리 표가 없으면 사진 0 · 못 채운 것에 이름", filled.photosPlaced === 0 && filled.skipped.includes("자리 표(전·후)"), filled.skipped.join(","));
  check("결과 보고서: 캐시 없음 · 표 짝 맞음", !out.sections[0].includes("linesegarray") && (out.sections[0].match(/<hp:tbl /g) ?? []).length === (out.sections[0].match(/<\/hp:tbl>/g) ?? []).length);

  // 표 밖 머리 줄(순찰기간 · 보고자). 기본 양식에 두 줄을 끼워 「남의 양식」을 흉내 낸다.
  const { unzipSync, zipSync, strToU8 } = await import("fflate");
  const withHead = (periodLine, reporterLine) => {
    const files = unzipSync(form);
    const xml = strFromU8(files["Contents/section0.xml"]);
    const para = (text) => `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
    const at = xml.lastIndexOf("</hs:sec>");
    files["Contents/section0.xml"] = strToU8(xml.slice(0, at) + para(periodLine) + para(reporterLine) + xml.slice(at));
    return zipSync(files, { level: 0 });
  };
  const headForm = withHead("❏ 순찰기간 :  2026.   .   .  ~   .   .", "❏ 보 고 자 :  직급             성명");
  const headOut = openHwpx(fillPeriodForm(headForm, mapPeriodForm(openHwpx(headForm)), { dong: "○○동", officer: "홍길동", summary, photos: [] }).bytes).sections[0];
  check("결과 보고서: 빈 순찰기간 줄에 기간을 적는다", headOut.includes("<hp:t>❏ 순찰기간 :  2026. 5. 11.(월) ~ 5. 17.(일)</hp:t>"), /<hp:t>[^<]*순찰기간[^<]*<\/hp:t>/.exec(headOut)?.[0]);
  check("결과 보고서: 보고자 줄의 성명 뒤에 담당자를 잇는다", headOut.includes("<hp:t>❏ 보 고 자 :  직급             성명 홍길동</hp:t>"), /<hp:t>[^<]*보 고 자[^<]*<\/hp:t>/.exec(headOut)?.[0]);
  const written = withHead("❏ 순찰기간 :  2026. 4. 1. ~ 4. 30.", "❏ 보 고 자 :  직급 ○○  성명 △△△");
  const keptOut = fillPeriodForm(written, mapPeriodForm(openHwpx(written)), { dong: "○○동", officer: "홍길동", summary, photos: [] });
  const keptXml = openHwpx(keptOut.bytes).sections[0];
  check("결과 보고서: 이미 적힌 머리 줄은 건드리지 않는다", keptXml.includes("2026. 4. 1. ~ 4. 30.") && keptXml.includes("성명 △△△</hp:t>") && !keptOut.skipped.includes("순찰기간"), keptOut.skipped.join(","));
  check("결과 보고서: 담당자 이름이 없으면 보고자 줄은 그대로", openHwpx(fillPeriodForm(headForm, mapPeriodForm(openHwpx(headForm)), { dong: "○○동", summary, photos: [] }).bytes).sections[0].includes("성명</hp:t>"));
}

if (problems.length > 0) {
  console.error(`\n${checked - problems.length}/${checked} 통과 · 실패 ${problems.length}건`);
  for (const problem of problems) console.error(`  → ${problem}`);
  process.exit(1);
}
console.log(`\n${checked}/${checked} 통과 · scratch-bridge.hwpx 를 한글에서 열어 눈으로 확인`);
