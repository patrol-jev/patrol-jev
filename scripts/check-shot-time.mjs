/**
 * 찍힌 시각 읽기 회귀 검사.
 *
 * `src/core/shot-time.ts` 를 고쳤으면 이걸 돌리세요. **API 를 부르지 않습니다**. 돈도 안 들고
 * 인터넷도 필요 없습니다. 사진도 들어가지 않고, 실제로 읽힌 글자의 꼴만 들어갑니다.
 *
 *   npm run check:time      (노드 22 이상)
 *
 * 여기 있는 꼴은 실물에서 나온 것입니다. 새로운 카메라 앱 꼴을 만나면 한 줄 더 적으세요.
 */

import {
  commonDate,
  countBackwards,
  minutesBetween,
  readStamp,
  stampFromClock,
} from "../src/core/shot-time.ts";

const CASES = [
  // ── 실물에서 그대로 나온 꼴
  ["Galaxy S23\n2026년 5월 12일 오전 6:28", "2026-05-12", "06:28"],
  ["772-9578\n○○대로104길\n80\nGalaxy S23\n2026년 5월 12일 오전 9:46", "2026-05-12", "09:46"],

  // ── 12시 함정. 오후 12시는 정오이고 오전 12시는 자정이다.
  ["2026년 5월 12일 오후 12:29", "2026-05-12", "12:29"],
  ["2026년 5월 12일 오전 12:05", "2026-05-12", "00:05"],
  ["2026년 5월 13일 오전 0:10", "2026-05-13", "00:10"],

  // ── 다른 꼴
  ["2026-05-12 18:04", "2026-05-12", "18:04"],
  ["2026.05.12 6:28", "2026-05-12", "06:28"],
  ["2026/05/12 6:28 PM", "2026-05-12", "18:28"],
  ["오전 6:28", "", "06:28"],

  // ── 시각이 아닌 것을 시각으로 읽지 않는다
  ["주차금지 / 화물차", null, null],
  ["쓰레기 무단투기 적발 시 100만원 이하의 과태료", null, null],
  ["○○로12길 34", null, null],
  [null, null, null],
];

const problems = [];

for (const [text, date, time] of CASES) {
  const got = readStamp(text);
  const label = JSON.stringify(text)?.replace(/\\n/g, " | ") ?? "null";

  if (time === null) {
    if (got !== null) problems.push(`${label}: 시각이 없어야 하는데 ${got.time}`);
    else console.log(`OK   ${label}\n      읽지 않음`);
    continue;
  }
  if (got === null) {
    problems.push(`${label}: ${time} 이어야 하는데 못 읽음`);
    continue;
  }
  if (got.time !== time || got.date !== date) {
    problems.push(`${label}: ${date} ${time} 이어야 하는데 ${got.date} ${got.time}`);
    continue;
  }
  console.log(`OK   ${label}\n      ${got.date || "날짜 없음"}  ${got.time}`);
}

// ── 몇 분 차인가. 「같은 자리인가」의 재료라 여기서 틀리면 묶기가 틀린다.
const GAPS = [
  ["2026년 5월 12일 오전 6:28", "2026년 5월 12일 오전 6:31", 3],
  ["2026년 5월 12일 오전 6:28", "2026년 5월 12일 오전 6:28", 0],
  ["2026년 5월 12일 오전 9:46", "2026년 5월 12일 오전 10:17", 31],
  // 자정을 넘긴 순찰. 날짜를 같이 보지 않으면 -1420 분이 된다.
  ["2026년 5월 12일 오후 11:50", "2026년 5월 13일 오전 0:10", 20],
];

for (const [a, b, want] of GAPS) {
  const got = minutesBetween(readStamp(a), readStamp(b));
  if (got !== want) problems.push(`분 차이 ${a} → ${b}: ${want} 이어야 하는데 ${got}`);
  else console.log(`OK   분 차이 ${want}분`);
}

// 한쪽이라도 시각을 모르면 「모른다」여야 한다. 0 이 되면 바로 다음 장이라고 거짓말하는 것이다.
if (minutesBetween(null, readStamp("오전 6:28")) !== null) {
  problems.push("분 차이: 한쪽을 모르면 null 이어야 한다");
} else {
  console.log("OK   한쪽을 모르면 null");
}

// EXIF 로 이미 아는 시각도 같은 꼴로 들어와야 한다.
if (stampFromClock("2026-05-12", "06:28")?.minutes !== 388) {
  problems.push("EXIF 시각: 06:28 은 388분이어야 한다");
} else if (stampFromClock("", "25:99") !== null) {
  problems.push("EXIF 시각: 말이 안 되는 시각은 null 이어야 한다");
} else {
  console.log("OK   EXIF 시각");
}

// ── 차례가 거꾸로인 대목 세기. 묶기가 「찍은 차례」를 전제로 도니 이게 0 이 아니면 알려야 한다.
const ORDERS = [
  [["06:28", "06:31", "09:46"], 0],
  // 가운데 한 장이 앞 시각. 실물 회수본에서 이렇게 올라왔다.
  [["06:46", "06:28", "09:46"], 1],
  // 시각을 못 읽은 장은 건너뛰고 센다. 모르는 것을 거꾸로라고 하지 않는다.
  [["09:46", null, "06:28"], 1],
  [[null, null, null], 0],
];

for (const [times, want] of ORDERS) {
  const stamps = times.map((time) => (time ? readStamp(`2026년 5월 12일 ${time}`) : null));
  const got = countBackwards(stamps);
  if (got !== want) problems.push(`차례 ${times.join(",")}: ${want} 이어야 하는데 ${got}`);
  else console.log(`OK   차례 거꾸로 ${want}군데`);
}

// ── 회차의 날짜는 많이 나온 쪽. 한 장이 잘못 읽혀도 일지 날짜가 끌려가면 안 된다.
const DATES = [
  [["2026-05-12", "2026-05-12", "2026-06-01"], "2026-05-12"],
  [["", "2026-05-12", null], "2026-05-12"],
  // 같은 수면 이른 날짜로. 순찰은 앞 날짜에서 시작한다.
  [["2026-05-13", "2026-05-12"], "2026-05-12"],
  [[null, "", null], ""],
];

for (const [dates, want] of DATES) {
  const got = commonDate(dates);
  if (got !== want) problems.push(`회차 날짜 ${JSON.stringify(dates)}: ${want || "(없음)"} 이어야 하는데 ${got || "(없음)"}`);
  else console.log(`OK   회차 날짜 ${want || "(없음)"}`);
}

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건`);
  for (const problem of problems) console.error(`  → ${problem}`);
  process.exit(1);
}

const total = CASES.length + GAPS.length + ORDERS.length + DATES.length + 2;
console.log(`\n${total}/${total} 통과`);
