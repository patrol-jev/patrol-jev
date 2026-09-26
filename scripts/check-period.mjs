/**
 * 기간 보고서 회귀 검사. 집계 · 글 · 기본 양식 hwpx · 주간 일지 재료.
 *
 * **API 를 부르지 않습니다.** 지어낸 하루치 기록 몇 개로 한 달을 모으고, 숫자가 맞는지, 글이 그 숫자를
 * 그대로 옮기는지, 한글이 열지 못하는 조건이 없는지 봅니다. 사람 눈 확인은 `scratch-period.hwpx`.
 *
 *   npm run check:period      (노드 22 이상)
 *
 * 여기 들어가는 값은 전부 지어낸 것입니다. 실물 사진도, 실제 지명도 들어가지 않습니다.
 */

import { writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { buildPeriodHwpx } from "../src/core/hwpx/period.ts";
import { buildIljiHwpx } from "../src/core/hwpx/ilji.ts";
import { CATEGORY_ROWS, categoryOf, customPeriod, isRequest, monthPeriod, periodText, summarisePeriod, weekName, weekPeriod } from "../src/core/period.ts";
import { pickPhotos } from "../src/core/ilji-slots.ts";
import { buildReport } from "../src/core/report.ts";
import { dayTag, slotsFromDay, weekDays } from "../src/core/weekly.ts";

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

// ── ① 기간 고르기
const w = weekPeriod("2026-09-23");
check("주는 월요일부터 일요일까지", w.from === "2026-09-21" && w.to === "2026-09-27", `${w.from}~${w.to}`);
check("주 라벨", w.label === "2026. 9. 21.(월) ~ 9. 27.(일)", w.label);
check("주 이름은 월요일 날짜로 센 주차", w.name === "2026년 9월 3주차" && w.kind === "week", w.name);
check("주차 셈법(1~7일 = 1주차, 8~14일 = 2주차)", weekName("2026-09-01") === "9월 1주차" && weekName("2026-09-08") === "9월 2주차" && weekName("2026-09-29") === "9월 5주차");
const m = monthPeriod("2026-02");
check("달 끝날", m.to === "2026-02-28" && m.label === "2026년 2월" && m.name === "2026년 2월", `${m.to} ${m.label}`);
const c = customPeriod("2026-09-30", "2026-09-01");
check("직접 고른 기간은 거꾸로 줘도 바로잡는다", c.from === "2026-09-01" && c.to === "2026-09-30" && c.kind === "custom");

// ── ② 하루치 기록을 지어낸다. 자리 목록은 일지를 만들 때 남기는 것과 같은 꼴.
function day(date, groups, extraText = "") {
  const report = buildReport({ dong: "○○동", date, groups, seasonalSpots: [] });
  const picks = pickPhotos(groups, () => false, () => 0);
  const byId = new Map(groups.map((g) => [g.id, g]));
  return {
    date,
    savedAt: `${date}T10:00:00.000Z`,
    photos: groups.reduce((n, g) => n + g.photos.length, 0),
    groups: groups.length,
    report: report.full + extraText,
    dong: "○○동",
    spots: picks.map((p) => {
      const g = byId.get(p.groupId);
      return { address: g.address, lane: g.lane, work: g.work ?? "", time: g.time, shade: g.shade, pair: p.pair, before: p.before !== null, after: p.after !== null };
    }),
    undecided: groups.filter((g) => g.lane === "unknown").length,
  };
}
const g = (id, photos, address, lane, extra = {}) => ({ id, photos, address, lane, edited: false, time: "09:00", ...extra });

const days = [
  day("2026-09-01", [g("a", [0, 1], "○○로12길 34", "waste_cleanup"), g("b", [2, 3], "△△로 5", "waste_cleanup"), g("c", [4], "□□길 7-1", "risk_facility", { work: "도로 파손 확인, 스마트불편신고, 경과 관찰" })]),
  day("2026-09-08", [g("a", [0, 1], "○○로 12길 34", "waste_cleanup"), g("d", [2], "", "flood_season")], "\n\n※ 특이사항: 가로등 1개 소등 확인"),
  day("2026-09-15", [g("a", [0, 1], "○○로12길 34", "waste_cleanup"), g("e", [2, 3], "◇◇로 9", "unknown"), g("f", [4], "◎◎공원", "flood_season", { shade: true })]),
  day("2026-09-16", [g("h", [0], "▽▽길 3", "risk_facility", { work: "옹벽 균열 확인" })]),
  // 옛 기록. 자리 목록이 없다.
  { date: "2026-09-22", savedAt: "", photos: 6, groups: 3, report: "○○동 현장 점검 일지 (2026-09-22)\n\n□ 순찰사항\n  ○ 해당 없음", dong: "○○동" },
  // 기간 밖.
  day("2026-10-02", [g("z", [0, 1], "○○로12길 34", "waste_cleanup")]),
];

// ── ③ 한 달 집계
const s = summarisePeriod(days, monthPeriod("2026-09"));
check("기간 안의 날만 센다(옛 기록 포함)", s.days === 5, String(s.days));
check("란별 개소", s.counts.patrol === 4 && s.counts.seasonal === 2 && s.counts.facility === 2, JSON.stringify(s.counts));
check("처리 개소 합", s.places === 8, String(s.places));
check("사진 수(순찰사항은 전·후, 다른 란은 한 장)", s.shots === 12, String(s.shots));
check("갈래 미정 수", s.undecided === 1, String(s.undecided));
check("옛 기록이 섞였다고 알린다", s.hasLegacy === true);
check("일자별 줄 다섯", s.lines.length === 5 && s.lines[4].legacy === true);
check("반복 지점은 띄어쓰기 달라도 한 자리(세 번)", s.repeats.length === 1 && s.repeats[0].dates.length === 3 && s.repeats[0].address === "○○로12길 34", JSON.stringify(s.repeats));
check("위험시설물 내역은 말을 ※ → 로 나눈다", s.facilities.length === 2 && s.facilities[0].parts.join("|") === "도로 파손 확인|스마트불편신고|경과 관찰", JSON.stringify(s.facilities));
check("특이사항을 날짜와 함께", s.etc.length === 1 && s.etc[0].date === "2026-09-08" && s.etc[0].text === "가로등 1개 소등 확인", JSON.stringify(s.etc));

// 항목표. 순찰사항 → 청소 기타, 계절특수 → 치수방재 기타, 그늘막 → 공공시설물 기타, 위험시설물 → 신고면 정비요청 아니면 순찰활동.
const row = (group, item) => s.categories.find((x) => x.group === group && x.item === item);
check("항목표 줄 수는 양식 그대로(27)", s.categories.length === 27 && CATEGORY_ROWS.length === 27);
check("청소 · 기타 자체정비 4", row("청소", "기타(자체정비 포함)")?.self === 4, JSON.stringify(row("청소", "기타(자체정비 포함)")));
check("치수방재 · 기타 자체정비 1", row("치수방재", "기타(자체정비 포함)")?.self === 1);
check("그늘막은 공공시설물 · 기타 1", row("공공시설물", "기타(자체정비 포함)")?.self === 1);
check("신고한 위험시설물은 정비요청 1", row("재난위험시설물", "재난위험시설 정비요청")?.requested === 1 && row("재난위험시설물", "재난위험시설 정비요청")?.self === 0);
check("확인만 한 위험시설물은 순찰활동 1", row("재난위험시설물", "재난위험시설 순찰활동")?.self === 1);
check("사진으로 모르는 줄은 0 이 아니라 빈 칸(null)", row("교통", "방치차량 정비요청")?.self === null && row("교통", "방치차량 정비요청")?.requested === null);
check("정비요청 합 1 · 자체정비 합 7 · 총계 = 개소", s.requested === 1 && s.self === 7 && s.requested + s.self === s.places, `${s.requested}/${s.self}/${s.places}`);
check("isRequest 는 첫 마디를 안 본다", isRequest("신고 확인") === false && isRequest("확인, 스마트불편신고") === true && isRequest("확인") === false);
check("categoryOf: 모르겠음은 없음", categoryOf({ address: "", lane: "unknown", work: "", time: "", pair: false, before: false, after: false }) === null);

// 정비요청 세부내역 · 자체 정비실적 세부내역.
check("정비요청 세부내역 한 줄(신고한 자리)", s.requests.length === 1 && s.requests[0].address === "□□길 7-1" && s.requests[0].group === "재난위험시설물" && s.requests[0].text.includes("스마트불편신고"), JSON.stringify(s.requests));
check("세부내역은 실린 자리 전부 · 연번 차례", s.details.length === 8 && s.details.every((d, i) => d.no === i + 1));
check("세부내역에 날짜 안 자리 번호(사진 사본 차례)", s.details[2].date === "2026-09-01" && s.details[2].index === 2 && s.details[2].request === true);
check("말이 없으면 란의 기본 말", s.details[0].work === "폐기물 처리 및 수거" && s.details[4].work === "배수구 주변 정비" && s.details[6].work === "그늘막 점검", `${s.details[0].work}/${s.details[4].work}/${s.details[6].work}`);

// ── ④ 글
const text = periodText(s, "○○동");
check("제목에 기간 이름", text.startsWith("○○동 현장 순찰 결과 보고 (2026년 9월)"), text.split("\n")[0]);
check("개요 줄", text.includes("○ 기간: 2026. 9. 1.(화) ~ 2026. 9. 30.(수) (순찰 5일)") && text.includes("○ 처리 개소: 8개소 (순찰사항 4 · 계절특수 2 · 위험시설물 2) · 사진 12장"), text.split("\n").slice(2, 5).join(" / "));
check("추진 실적 줄(총계 · 정비요청 · 자체정비)", text.includes("○ 추진 실적: 총계 8 (기능부서 정비요청 1 · 동 자체정비 7)"));
check("일자별 줄에 옛 기록 표시", text.includes("○ 9. 22.(화) 자리 정보 없음(이전 기록)"));
check("항목별 실적은 값 있는 줄만", text.includes("○ 청소 · 기타(자체정비 포함): 자체정비 4") && !text.includes("방치차량"));
check("반복 정비 지점은 글에서 뺐다", !text.includes("반복 정비 지점"));
check("위험시설물 내역 ※ →", text.includes("○ 9. 1.(화) □□길 7-1 도로 파손 확인") && text.includes("- ※ 스마트불편신고") && text.includes("- → 경과 관찰"));
check("정비요청 세부내역 줄", text.includes("□ 기능부서 정비요청 세부내역") && text.includes("○ 1. 9. 1.(화) 재난위험시설물 · □□길 7-1 ·"));
check("특이사항 줄", text.includes("□ 특이사항") && text.includes("○ 9. 8.(화) 가로등 1개 소등 확인"));
check("주민소통은 없으면 절도 없다", !text.includes("□ 주민소통"));
check("긴 줄표 없음", !text.includes("—"));

// ── ⑤ 기본 양식 hwpx. 사진은 세부내역 차례로 넘기고, 파일이 란별 · 날짜별로 다시 줄 세운다.
const photos = s.details
  .filter((d) => d.lane !== "unknown")
  .slice(0, 4)
  .map((d) => ({ date: d.date, lane: d.lane, no: d.no, work: d.work, caption: d.address, note: "", pair: d.pair, before: TINY_JPEG, after: d.pair ? TINY_JPEG : null }));
const bytes = buildPeriodHwpx({ dong: "○○동", unit: "환경순찰", officer: "", summary: s, photos });
try {
  writeFileSync("scratch-period.hwpx", bytes);
} catch {
  console.log("(scratch-period.hwpx 을 못 썼습니다. 한글에서 열려 있으면 닫고 다시 도세요.)");
}
const zip = unzipSync(bytes);
const names = Object.keys(zip);
check("첫 항목이 mimetype · 압축 없음", names[0] === "mimetype" && bytes[8] === 0 && bytes[9] === 0);
const header = strFromU8(zip["Contents/header.xml"]);
const section = strFromU8(zip["Contents/section0.xml"]);
const hpf = strFromU8(zip["Contents/content.hpf"]);

function wellFormed(source, name) {
  const xml = source.replace(/^<\?xml[^>]*\?>/, "");
  const stack = [];
  const re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g;
  let x;
  let pos = 0;
  while ((x = re.exec(xml))) {
    const between = xml.slice(pos, x.index);
    if (/[<]/.test(between) || /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(between)) return `${name}: 이스케이프 안 된 기호 (${between.slice(0, 40)})`;
    pos = x.index + x[0].length;
    const [, closing, tagName, , selfClosing] = x;
    if (closing) {
      if (stack.pop() !== tagName) return `${name}: </${tagName}> 짝이 안 맞음`;
    } else if (!selfClosing) stack.push(tagName);
  }
  return stack.length === 0 ? null : `${name}: 안 닫힌 태그 ${stack.join(",")}`;
}
check("header.xml 짝이 맞는다", wellFormed(header, "header") === null, wellFormed(header, "header") ?? "");
check("section0.xml 짝이 맞는다", wellFormed(section, "section") === null, wellFormed(section, "section") ?? "");
check("content.hpf 짝이 맞는다", wellFormed(hpf, "hpf") === null, wellFormed(hpf, "hpf") ?? "");

const fills = [...header.matchAll(/<hh:borderFill id="(\d+)"/g)].map((x) => Number(x[1]));
check("테두리 번호가 1부터 빈틈없이", fills.every((id, i) => id === i + 1), fills.join(","));
check("borderFills itemCnt", Number(/<hh:borderFills itemCnt="(\d+)"/.exec(header)?.[1]) === fills.length);
const refs = new Set([...section.matchAll(/borderFillIDRef="(\d+)"/g)].map((x) => Number(x[1])));
check("본문의 테두리 번호가 전부 header 에", [...refs].every((id) => fills.includes(id)));
const imgFills = [...header.matchAll(/binaryItemIDRef="(\w+)"/g)].map((x) => x[1]);
const binNames = names.filter((n) => n.startsWith("BinData/"));
const manifest = [...hpf.matchAll(/<opf:item id="(img\d+)"/g)].map((x) => x[1]);
check("사진 7장 = 그림 채움 7 = BinData 7 = 목록 7", imgFills.length === 7 && binNames.length === 7 && manifest.length === 7, `${imgFills.length}/${binNames.length}/${manifest.length}`);
check("줄 배치 캐시를 적지 않는다", !section.includes("linesegarray"));
check("셀 크기는 전부 정수", [...section.matchAll(/<hp:cellSz width="([^"]+)" height="([^"]+)"/g)].every((x) => /^\d+$/.test(x[1]) && /^\d+$/.test(x[2])));
const tables = [...section.matchAll(/<hp:tbl [^>]*>[\s\S]*?<\/hp:tbl>/g)].map((x) => x[0]);
/**
 * 한 표의 열 경계가 **한 격자**에 놓이는가. 셀마다 (열 번호, 병합 수, 너비)를 읽어 경계 위치를 풀어 간다.
 * 모순이 나면(같은 경계가 두 값) 한글 뷰어가 열을 넓게 잡아 오른쪽이 잘린다(09-26 실물). 세로 병합으로 비는
 * 칸도 이 방식이면 문제없다. 마지막 경계는 표 너비여야 한다.
 */
function gridConsistent(t) {
  const width = Number(/<hp:sz width="(\d+)"/.exec(t)?.[1]);
  const colCnt = Number(/colCnt="(\d+)"/.exec(t)?.[1]);
  const cells = [...t.matchAll(/<hp:cellAddr colAddr="(\d+)" rowAddr="\d+"\/><hp:cellSpan colSpan="(\d+)" rowSpan="\d+"\/><hp:cellSz width="(\d+)"/g)].map((x) => ({ col: Number(x[1]), span: Number(x[2]), width: Number(x[3]) }));
  const edge = new Map([[0, 0]]);
  for (let pass = 0; pass < colCnt + 2; pass++) {
    for (const c of cells) {
      const a = edge.get(c.col);
      const b = edge.get(c.col + c.span);
      if (a !== undefined && b === undefined) edge.set(c.col + c.span, a + c.width);
      else if (a === undefined && b !== undefined) edge.set(c.col, b - c.width);
      else if (a !== undefined && b !== undefined && b - a !== c.width) return `열 ${c.col}~${c.col + c.span} 너비 모순 ${b - a} vs ${c.width}`;
    }
  }
  if (edge.size !== colCnt + 1) return `경계 ${edge.size - 1}개, 열 ${colCnt}개`;
  if (edge.get(colCnt) !== width) return `마지막 경계 ${edge.get(colCnt)} vs 표 너비 ${width}`;
  return null;
}
check("표마다 열 경계가 한 격자에 놓이고 끝이 표 너비(오른쪽 잘림 원인)", tables.every((t) => gridConsistent(t) === null), tables.map(gridConsistent).filter(Boolean).join(" / "));
check("표 행 수 = rowCnt", tables.every((t) => Number(/rowCnt="(\d+)"/.exec(t)?.[1]) === (t.match(/<hp:tr>/g) ?? []).length));
check("표 수 = 띠 · 1쪽 · 항목표 · 정비요청표 · 사진 4", tables.length === 4 + 4, String(tables.length));
check("제목 · 부제(기간 이름은 띠에만)", section.includes("<hp:t>현장 순찰 결과 보고서</hp:t>") && section.includes("<hp:t>○○동 · 환경순찰</hp:t>") && section.includes("<hp:t>2026년 9월</hp:t>"));
check("기간 칸 · 순찰 일수", section.includes("2026. 9. 1.(화) ~ 9. 30.(수)") && section.includes("<hp:t>5일</hp:t>"));
check("처리 개소 칸", section.includes("8개소 · 사진 12장"));
check("추진 실적 두 줄(란별 · 총계)", section.includes("□ 추진 실적") && section.includes("<hp:t>기능부서 정비요청</hp:t>") && section.includes("<hp:t>동 자체정비</hp:t>"));
check("일자별 실적 머리띠에 일수 · 옛 기록 「-」", section.includes("□ 일자별 실적 · 5일") && (section.match(/<hp:t>-<\/hp:t>/g) ?? []).length === 3);
check("반복 정비 지점 칸은 없다", !section.includes("반복 정비 지점"));
check("위험시설물 줄에 ※ → (줄머리 「-」 없이)", section.includes("<hp:t>  ※ 스마트불편신고</hp:t>") && section.includes("<hp:t>  → 경과 관찰</hp:t>") && !section.includes("- ※"));
check("특이사항 칸이 있다 · 주민소통은 없다", section.includes("□ 특이사항 · 1건") && !section.includes("□ 주민소통"));
check("2쪽 항목표 제목 · 27줄 전부 · 합계", section.includes("1. 기능부서 정비요청 및 자체정비 추진 실적") && CATEGORY_ROWS.every((r) => section.includes(`∘ ${r.item}`)) && section.includes("<hp:t>합계</hp:t>"));
check("항목표 구분 칸은 세로 병합", /rowSpan="4"/.test(section) && /rowSpan="3"/.test(section));
check("3쪽 정비요청 세부내역 · 한 줄", section.includes("2. 기능부서 정비요청 세부내역") && section.includes("<hp:t>요청부서</hp:t>") && section.includes("9. 1.(화) □□길 7-1"));
check("4쪽 현장 사진은 란별로 묶고 날짜 차례", (() => {
  const a = section.indexOf("순찰사항 · 3건");
  const b = section.indexOf("위험시설물 · 1건");
  const first = section.indexOf("□ 9. 1.(화)   ○○로12길 34");
  const third = section.indexOf("□ 9. 8.(화)   ○○로 12길 34");
  return a > 0 && b > a && first > a && third > first && third < b;
})());
check("사진 표 머리에 날짜 · 주소 · 말", section.includes("□ 9. 1.(화)   □□길 7-1   ·   도로 파손 확인 · 스마트불편신고 · 경과 관찰"));
check("짝 자리는 정비 전·후, 아니면 현장 확인", section.includes("정비 전") && section.includes("현장 확인"));
check("담당자 기재 안내 한 줄만", !section.includes("빈 칸은 사진으로") && section.includes("<hp:t>※ 요청부서와 문서번호는 담당자가 기재합니다.</hp:t>"));
check("상표·도구 이름이 없다", !/patrol-jev|PJ|Jev|OpenAI/.test(section));
check("긴 줄표 없음", !section.includes("—"));
check("같은 입력이면 같은 XML", strFromU8(unzipSync(buildPeriodHwpx({ dong: "○○동", unit: "환경순찰", officer: "", summary: s, photos }))["Contents/section0.xml"]) === section);

// 사진이 없어도 파일은 나간다.
const none = strFromU8(unzipSync(buildPeriodHwpx({ dong: "○○동", unit: "", officer: "", summary: summarisePeriod([], monthPeriod("2026-08")), photos: [] }))["Contents/section0.xml"]);
check("기록이 없는 달도 파일이 나간다(해당 없음)", none.includes("<hp:t>해당 없음</hp:t>") && none.includes("실은 사진 없음"));

// ── ⑥ 주간 일지 재료. 그 주의 하루치를 일지 자리로 되돌리고 몇째 날인지 적는다.
const wk = weekPeriod("2026-09-16");
const inWeek = weekDays(days, wk);
check("그 주의 하루치만 날짜 차례로", inWeek.map((d) => d.date).join(",") === "2026-09-15,2026-09-16");
check("몇째 날 표시(월요일이 1 · 주차는 월요일 14일이라 2주차)", dayTag(wk, "2026-09-15") === "9월 2주차 · 2/5" && dayTag(wk, "2026-09-19") === "9월 2주차 · 토", `${dayTag(wk, "2026-09-15")} / ${dayTag(wk, "2026-09-19")}`);
const stored = [{ before: null, after: null }, { before: TINY_JPEG, after: null }, { before: TINY_JPEG, after: TINY_JPEG }];
const slots = slotsFromDay(inWeek[0], stored, "○○동장", "환경순찰", 3);
check("일지 자리: 개요는 글에서, 순찰자·부서는 설정에서", slots.dateLabel.startsWith("2026. 9. 15.(화)") && slots.officer === "○○동장" && slots.unit === "환경순찰" && slots.area === "○○동 관내 전지역", `${slots.dateLabel} / ${slots.area}`);
check("일지 자리: 란별 개소", slots.counts.patrol === 1 && slots.counts.seasonal === 1 && slots.counts.facility === 0);
check("일지 자리: 모르겠음 자리는 안 싣고, 사진 있는 자리가 먼저", slots.photos.length === 2 && slots.photos[0].caption === "◎◎공원" && slots.photos[1].caption === "○○로12길 34", slots.photos.map((p) => p.caption).join(","));
check("일지 자리: 상한을 지킨다", slotsFromDay(inWeek[0], stored, "", "", 1).photos.length === 1);
check("일지 자리: 사진 사본이 없으면 빈 칸으로", slotsFromDay(inWeek[0], null, "", "", null).photos.every((p) => p.before === null && p.after === null));

// 일지 쪽 사진 표를 공용으로 뺐으니 일지가 여전히 같은 표를 내는지 한 번 더.
const ilji = strFromU8(unzipSync(buildIljiHwpx({ dong: "○○동", unit: "", officer: "", dateLabel: "", area: "", rows: { seasonal: [], facility: [], community: [], patrol: [], etc: [] }, photos: [{ caption: "△△로 5", note: "순찰사항", pair: true, before: TINY_JPEG, after: null }] }))["Contents/section0.xml"]);
check("일지의 사진 표도 같은 꼴(머리·전·후)", ilji.includes("□ △△로 5   ·   순찰사항") && ilji.includes("정비 전") && ilji.includes("정비 후"));

console.log("");
if (problems.length > 0) {
  console.log(`${problems.length}건 실패 / ${checked}건`);
  for (const p of problems) console.log(`FAIL ${p}`);
  process.exit(1);
}
console.log(`${checked}/${checked} 통과 · scratch-period.hwpx 를 한글에서 열어 눈으로 확인`);
