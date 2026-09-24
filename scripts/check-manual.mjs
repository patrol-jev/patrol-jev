/**
 * 수동 모드 회귀 검사. 모델 없이 도는 길.
 *
 * **API 도, 사진도, 키도, 인터넷도 없이 돕니다.** 이 모드의 요점이 바로 그것이라,
 * 검사에 네트워크가 한 줄이라도 끼면 검사가 그 요점을 안 지키는 셈이 됩니다.
 *
 *   npm run check:manual      (노드 22 이상)
 *
 * 여기 들어가는 값은 전부 지어낸 것입니다. 실물 사진도, 실제 지명도 들어가지 않습니다.
 */

import {
  allPhrases,
  defaultPhrases,
  laneOfPhrase,
  manualGroups,
  splitManual,
} from "../src/core/manual.ts";
import { buildReport, DEFAULT_WORDING } from "../src/core/report.ts";
import { stampFromClock } from "../src/core/shot-time.ts";

const OPTIONS = { groupSize: 3, sameMinutes: 2, lane: "waste_cleanup" };

const problems = [];
let checked = 0;

function check(name, condition, detail = "") {
  checked++;
  if (condition) console.log(`OK   ${name}`);
  else problems.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

/** 사진 n장. 시각을 주면 그 장에만 붙는다(빈 문자열 = 시각 모르는 장). */
function photos(...times) {
  return times.map((time, index) => ({
    index,
    stamp: time ? stampFromClock("2026-05-12", time) : null,
  }));
}

/** 묶음을 「장 수」 목록으로. 어디서 갈렸는지 한눈에 보인다. */
function shape(groups) {
  return groups.map((group) => group.photos.length).join("-");
}

// ── ① 시각을 모르면 장수로 끊는다. 한 자리에서 전·후·주소판 석 장이 보통이다.
{
  const { groups, by } = manualGroups(photos("", "", "", "", "", "", "", "", ""), OPTIONS);
  check("시각이 없으면 장수로 끊는다", by === "count", by);
  check("9장이면 3자리", shape(groups) === "3-3-3", shape(groups));
}

// ── ② 딱 떨어지지 않아도 남는 장을 버리지 않는다.
{
  const { groups } = manualGroups(photos("", "", "", "", "", "", "", "", "", ""), OPTIONS);
  check("10장이면 마지막 자리가 한 장", shape(groups) === "3-3-3-1", shape(groups));
  check(
    "사진은 한 장도 안 빠진다",
    groups.flatMap((group) => group.photos).length === 10,
    shape(groups),
  );
}

// ── ③ 찍힌 시각이 있으면 시각이 이긴다. 장수보다 정확하다.
{
  // 한 자리에서 09:00·09:01 · 걸어서 09:10 · 그 자리에서 09:11·09:12
  const { groups, by } = manualGroups(photos("09:00", "09:01", "09:10", "09:11", "09:12"), OPTIONS);
  check("시각이 있으면 시각으로 묶는다", by === "time", by);
  check("붙은 시각끼리 한 자리", shape(groups) === "2-3", shape(groups));
  check("자리의 시각은 가장 이른 장", groups[0].time === "09:00", groups[0].time);
  check("다음 자리도 가장 이른 장", groups[1].time === "09:10", groups[1].time);
}

// ── ④ 시각이 넉 장 중 한 장뿐이면 시각으로 안 간다. 반쯤 아는 시각으로 묶으면
//      아는 자리만 맞고 모르는 자리는 아무 데나 붙는다. 그럴 바엔 규칙 하나로 간다.
{
  const { by } = manualGroups(photos("09:00", "", "", ""), OPTIONS);
  check("시각을 아는 장이 절반 이하면 장수로", by === "count", by);
}

// ── ⑤ 시각 규칙을 끄면(0) 시각이 다 있어도 장수로 간다.
{
  const { by, groups } = manualGroups(photos("09:00", "09:01", "09:02", "09:03"), {
    ...OPTIONS,
    sameMinutes: 0,
  });
  check("sameMinutes 0 이면 시각을 안 쓴다", by === "count", by);
  check("그때는 장수로 끊는다", shape(groups) === "3-1", shape(groups));
}

// ── ⑥ 시각 모드에서 시각 없는 장을 만나도 자리를 새로 열지 않는다.
//      모른다고 무조건 끊으면 시각이 빠진 장마다 자리가 하나씩 늘어난다.
{
  const { groups, by } = manualGroups(photos("09:00", "", "09:01", "09:20", "09:21"), OPTIONS);
  check("시각 모드로 간다", by === "time", by);
  check("시각 없는 장은 앞자리에 붙는다", shape(groups) === "3-2", shape(groups));
}

// ── ⑦ 새 자리의 기본값. 주소는 **비어 있는 것이 기본**이다.
{
  const { groups } = manualGroups(photos("", "", ""), OPTIONS);
  const [group] = groups;
  check("주소는 빈칸으로 시작한다", group.address === "", JSON.stringify(group.address));
  check("갈래는 넘긴 기본 갈래", group.lane === "waste_cleanup", group.lane);
  check("아직 사람이 손대지 않았다", group.edited === false, String(group.edited));
  check("적을 말은 아직 없다", group.work === undefined, String(group.work));
}

// ── ⑧ 말 하나에 란 하나. 사람이 말을 고르면 란이 따라온다.
{
  const list = defaultPhrases();
  check("기본 말은 넷", list.length === 4, String(list.length));
  check(
    "「폐기물 처리 및 수거」는 순찰사항",
    laneOfPhrase(DEFAULT_WORDING.patrolWork, list) === "waste_cleanup",
  );
  check(
    "배수구 말은 계절특수",
    laneOfPhrase(DEFAULT_WORDING.drainWork, list) === "flood_season",
  );
  check(
    "「현장 확인」은 위험시설물",
    laneOfPhrase(DEFAULT_WORDING.facilityWork, list) === "risk_facility",
  );
  check("모르는 말은 짐작하지 않는다", laneOfPhrase("처음 보는 말", list) === null);
  check("빈 말도 짐작하지 않는다", laneOfPhrase("   ", list) === null);
}

// ── ⑨ 보고서에서 문구를 고쳐 뒀으면 고른 목록도 그 말로 바뀐다.
//      부서마다 쓰는 말이 달라도 코드를 고칠 일이 없다는 약속이 이 모드에서도 살아야 한다.
{
  const list = defaultPhrases({ patrolWork: "폐기물 경고스티커 부착" });
  check("고친 말이 목록에 온다", list[0].text === "폐기물 경고스티커 부착", list[0].text);
  check("란은 그대로 순찰사항", list[0].lane === "waste_cleanup", list[0].lane);
  check("고친 말로 란을 찾는다", laneOfPhrase("폐기물 경고스티커 부착", list) === "waste_cleanup");
}

// ── ⑩ 써 본 말이 뒤에 붙는다. 기본 넷과 겹치면 두 번 안 나온다.
{
  const list = allPhrases(undefined, [
    { text: "가로등 파손 신고", lane: "risk_facility" },
    { text: DEFAULT_WORDING.patrolWork, lane: "waste_cleanup" },
  ]);
  check("기본 넷이 앞", list.slice(0, 4).every((one, i) => one.text === defaultPhrases()[i].text));
  check("써 본 말이 뒤에", list[4]?.text === "가로등 파손 신고", list[4]?.text);
  check("겹치는 말은 한 번만", list.length === 5, String(list.length));
}

// ── ⑪ 나누기. 주소는 앞쪽만 가진다. 뒤쪽은 다른 자리라 앞의 주소를 물려주면 틀린 주소가 는다.
{
  const stamps = { 0: stampFromClock("2026-05-12", "09:00"), 1: null, 2: stampFromClock("2026-05-12", "09:30") };
  const group = {
    id: "m0",
    photos: [0, 1, 2],
    address: "○○로12길 34",
    lane: "risk_facility",
    edited: true,
    work: "현장 확인",
    time: "09:00",
  };
  const halves = splitManual(group, 2, stamps);
  check("둘로 갈린다", halves.length === 2, String(halves.length));
  check("앞은 두 장", halves[0].photos.join(",") === "0,1", halves[0].photos.join(","));
  check("뒤는 한 장", halves[1].photos.join(",") === "2", halves[1].photos.join(","));
  check("주소는 앞쪽만", halves[0].address === "○○로12길 34" && halves[1].address === "");
  check("갈래는 양쪽이 물려받는다", halves.every((half) => half.lane === "risk_facility"));
  check("적을 말도 양쪽이 물려받는다", halves.every((half) => half.work === "현장 확인"));
  check("뒤쪽 시각은 그 자리의 것", halves[1].time === "09:30", halves[1].time);
  check("첫 장에서는 안 나뉜다", splitManual(group, 0, stamps).length === 1);
}

// ── ⑫ 일지가 나온다. 묶기 뒤는 자동 모드와 **같은 코드**다.
{
  const { groups } = manualGroups(photos("09:00", "09:01", "09:20", "09:21"), OPTIONS);
  groups[0].address = "○○로12길 34";
  groups[1].address = "○○로34길 5";
  groups[1].work = "폐기물 경고스티커 부착";

  const report = buildReport({
    dong: "○○동",
    date: "2026-05-12",
    groups,
    seasonalSpots: [],
  });
  const waste = report.blocks.find((block) => block.key === "waste_cleanup");

  check("두 자리가 순찰사항에 실린다", waste?.count === 2, String(waste?.count));
  check("대표 줄은 첫 자리 외 1개소", waste?.text.includes("○○로12길 34 외 1개소"), waste?.text);
  check(
    "기본 문구가 붙는다",
    waste?.text.includes("· ○○로12길 34 폐기물 처리 및 수거"),
    waste?.text,
  );
  check(
    "그 자리에 정한 말은 그 말로",
    waste?.text.includes("· ○○로34길 5 폐기물 경고스티커 부착"),
    waste?.text,
  );
  check("갈래가 다 정해져 있다", report.undecided === 0, String(report.undecided));
  check("머리글에 시각 폭이 찍힌다", report.header.includes("(09:00~09:20)"), report.header);
}

// ── ⑬ 주소를 하나도 안 적어도 일지는 나온다. 지어낸 주소보다 빈칸이 낫다.
{
  const { groups } = manualGroups(photos("", "", "", "", "", ""), OPTIONS);
  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const waste = report.blocks.find((block) => block.key === "waste_cleanup");
  check("개소 수만 적는다", waste?.text.includes("주소 미기재 2개소"), waste?.text);
  check("지어낸 주소가 없다", !/[가-힣]+로\d/.test(waste?.text ?? ""), waste?.text);
}

// ── ⑭ 같은 입력이면 늘 같은 글. README 가 그렇게 적었다.
{
  const make = () => {
    const { groups } = manualGroups(photos("09:00", "09:01", "09:30"), OPTIONS);
    groups[0].address = "○○로12길 34";
    return buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] }).full;
  };
  check("두 번 만들어도 한 글자도 안 다르다", make() === make());
}

if (problems.length > 0) {
  console.error(`\n${checked - problems.length}/${checked} 통과 · 실패 ${problems.length}건`);
  for (const problem of problems) console.error(`  → ${problem}`);
  process.exit(1);
}

console.log(`\n${checked}/${checked} 통과`);
