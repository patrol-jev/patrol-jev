/**
 * 묶기와 일지 문장 회귀 검사.
 *
 * **API 를 부르지 않습니다.** 사진도, 키도, 인터넷도 필요 없습니다. 판정은 이미 났다고 치고,
 * 그 뒤를 봅니다 — 어디서 묶음이 갈리는지, 어떤 문장이 나오는지, 그리고 같은 입력이
 * 늘 같은 글자를 내는지. README 가 「같은 사진이면 늘 같은 글」이라고 적었으니 그걸 지킵니다.
 *
 *   npm run check:report      (노드 22 이상)
 *
 * 여기 들어가는 값은 전부 지어낸 것입니다. 실물 사진도, 실제 지명도 들어가지 않습니다.
 */

import { buildGroups, wherePlate } from "../src/core/group.ts";
import { buildReport, DEFAULT_WORDING, learnWording } from "../src/core/report.ts";
import { stampFromClock } from "../src/core/shot-time.ts";

const THRESHOLDS = { lane: 0.8, sameLocation: 0.5, addressPlate: 0.7, sameMinutes: 2, splitMinutes: 5 };
/** 시각 규칙을 끈 문턱. 확률만 보던 때와 같은지 볼 때 쓴다. */
const NO_TIME = { ...THRESHOLDS, sameMinutes: 0 };

/** 「HH:MM」 들을 묶기가 받는 꼴로. 빈 문자열이면 시각을 모르는 장이다. */
function clocks(...times) {
  return Object.fromEntries(
    times.map((time, index) => [index, time ? stampFromClock("2026-05-12", time) : null]),
  );
}

const problems = [];
let checked = 0;

function check(name, condition, detail = "") {
  checked++;
  if (condition) console.log(`OK   ${name}`);
  else problems.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

/** 판정 한 장을 지어낸다. 안 적은 것은 그럴듯한 기본값으로. */
function judged(index, lane, extra = {}) {
  const probabilities = { waste_cleanup: 0, flood_season: 0, risk_facility: 0, none_of_these: 0 };
  probabilities[lane] = extra.top ?? 0.95;
  return {
    index,
    lane: lane === "none_of_these" ? "unknown" : lane,
    laneProbabilities: probabilities,
    laneConfidence: 0.9,
    stage: extra.stage ?? "before",
    stageProbabilities: {},
    addressPlate: extra.addressPlate ?? null,
    sameLocation: extra.sameLocation ?? null,
    ms: 250,
    inputTokens: 800,
    outputTokens: 100,
    model: "test",
  };
}

function described(index, signText = null) {
  return {
    index,
    caption: `photo ${index}`,
    textInPhoto: signText,
    signText,
    ms: 2000,
    inputTokens: 1500,
    outputTokens: 100,
  };
}

// ── ① 한 자리에서 두 장, 그리고 주소판. 주소판이 나오면 그 자리는 끝이다.
{
  const photos = [described(0), described(1), described(2, "○○로12길 34"), described(3)];
  const calls = [
    judged(0, "waste_cleanup"),
    judged(1, "waste_cleanup", { sameLocation: 0.8 }),
    judged(2, "none_of_these", { sameLocation: 0.9, addressPlate: 0.95 }),
    judged(3, "waste_cleanup", { sameLocation: 0.2 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("06:28", "06:29", "06:30", "07:10"));

  check("주소판까지가 한 묶음", groups.length === 2, `묶음 ${groups.length}개`);
  check("주소판 글자가 묶음의 주소가 된다", groups[0]?.address === "○○로12길 34", groups[0]?.address);
  check("묶음 시각은 그 안에서 가장 이른 것", groups[0]?.time === "06:28", groups[0]?.time);
  check(
    "묶음 갈래는 장마다의 확률을 평균한 것",
    groups[0]?.lane === "waste_cleanup",
    groups[0]?.lane,
  );
}

// ── ② 같은 자리라고 볼 수 없으면 나눈다. 의심스러우면 합치지 않는다.
{
  const photos = [described(0), described(1)];
  const calls = [judged(0, "waste_cleanup"), judged(1, "waste_cleanup", { sameLocation: 0.49 })];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  check("문턱 아래 같은자리는 나눈다", groups.length === 2, `묶음 ${groups.length}개`);
}

// ── ③ 확률이 문턱 아래면 갈래를 정하지 않는다. 비워 두는 것이 이 도구의 핵심이다.
{
  const photos = [described(0)];
  const calls = [judged(0, "waste_cleanup", { top: 0.4 })];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  check("문턱 아래 갈래는 모르겠음", groups[0]?.lane === "unknown", groups[0]?.lane);
}

// ── ④ 주소를 모르면 지어내지 않고, 몇 개소인지 적는다.
{
  const photos = [described(0), described(1)];
  const calls = [judged(0, "waste_cleanup"), judged(1, "waste_cleanup", { sameLocation: 0.1 })];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const waste = report.blocks.find((b) => b.key === "waste_cleanup");

  check("주소 없는 묶음은 개소로 적는다", waste?.text.includes("주소 미기재 2개소"), waste?.text);
  check("없는 주소를 지어내지 않는다", !/로\d+길/.test(waste?.text ?? ""), waste?.text);
  // 「주소 미기재 2개소 등 2개소」 — 같은 말을 두 번 하던 자리다.
  check("개소 수를 두 번 적지 않는다", !/개소 등 \d+개소/.test(waste?.text ?? ""), waste?.text);
}

// ── ④-2 주소를 아는 묶음과 모르는 묶음이 섞였을 때.
{
  const photos = [
    described(0), described(1), described(2, "○○로12길 34"), described(3), described(4),
  ];
  const calls = [
    judged(0, "waste_cleanup"),
    judged(1, "waste_cleanup", { sameLocation: 0.9 }),
    judged(2, "waste_cleanup", { addressPlate: 0.9, sameLocation: 0.9 }),
    judged(3, "waste_cleanup", { sameLocation: 0.1 }),
    judged(4, "waste_cleanup", { sameLocation: 0.1 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const waste = report.blocks.find((b) => b.key === "waste_cleanup");

  check(
    "대표 자리 뒤에 남은 개소를 적는다",
    waste?.text.includes("○○로12길 34 외 2개소"),
    waste?.text,
  );
  check(
    "주소를 모르는 자리도 한 줄로 남는다",
    waste?.text.includes("주소 미기재 2개소 폐기물 처리 및 수거"),
    waste?.text,
  );
}

// ── ④-3 주소를 다 알면 개수를 덧붙이지 않는다.
{
  const photos = [described(0, "○○로12길 34"), described(1, "○○로34길 5")];
  const calls = [
    judged(0, "waste_cleanup", { addressPlate: 0.9 }),
    judged(1, "waste_cleanup", { sameLocation: 0.1, addressPlate: 0.9 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const waste = report.blocks.find((b) => b.key === "waste_cleanup");

  check(
    "자리마다 한 줄씩 같은 말로 적는다",
    waste?.text.includes("· ○○로12길 34 폐기물 처리 및 수거") &&
      waste?.text.includes("· ○○로34길 5 폐기물 처리 및 수거"),
    waste?.text,
  );
}

// ── ⑤ 아무것도 없는 란은 「해당 없음」. 빈칸으로 두지 않는다.
{
  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups: [], seasonalSpots: [] });
  check(
    "빈 란은 해당 없음",
    report.blocks.every((b) => b.text.includes("해당 없음")),
  );
  check("세 란이 모두 있다", report.blocks.length === 3, `${report.blocks.length}개`);
  check("머리글에 날짜가 요일까지", report.header.includes("2026. 5. 12.(화)"), report.header);
}

// ── ⑥ 계절특수 자리는 설정의 고정 목록을 쓴다. 사진에서 읽지 않는다.
{
  const report = buildReport({
    dong: "○○동",
    date: "2026-05-12",
    groups: [],
    seasonalSpots: ["○○공원 앞", "○○역 2번 출구"],
  });
  const flood = report.blocks.find((b) => b.key === "flood_season");
  check("계절특수는 설정의 고정 지점을 쓴다", flood?.text.includes("○○공원 앞"), flood?.text);
}

// ── ⑦ 갈래가 안 정해진 묶음은 세어서 알린다. 조용히 넘어가지 않는다.
{
  const photos = [described(0)];
  const calls = [judged(0, "waste_cleanup", { top: 0.3 })];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  check("모르겠음 묶음을 센다", report.undecided === 1, `${report.undecided}`);
}

// ── ⑧ 같은 입력이면 같은 글자. 한 자도 달라지면 안 된다.
{
  const photos = [described(0), described(1, "○○로12길 34")];
  const calls = [
    judged(0, "risk_facility"),
    judged(1, "flood_season", { sameLocation: 0.6, addressPlate: 0.9 }),
  ];
  const once = buildReport({
    dong: "○○동",
    date: "2026-05-12",
    groups: buildGroups(photos, calls, THRESHOLDS, clocks("09:00", "09:01")),
    seasonalSpots: [],
  });
  const twice = buildReport({
    dong: "○○동",
    date: "2026-05-12",
    groups: buildGroups(photos, calls, THRESHOLDS, clocks("09:00", "09:01")),
    seasonalSpots: [],
  });
  check("같은 입력이면 같은 글자", once.full === twice.full);
  check("머리글에 시각 범위가 들어간다", once.header.includes("09:00~09:00"), once.header);
}

// ── ⑨ 찍힌 시각이 붙어 있으면 확률이 낮아도 잇는다. 같은 자리를 다른 각도로 찍으면
//     글로 옮긴 장면이 서로 달라 보이지만, 시각은 안 흔들린다.
{
  const photos = [described(0), described(1)];
  const calls = [judged(0, "waste_cleanup"), judged(1, "waste_cleanup", { sameLocation: 0.13 })];

  const joined = buildGroups(photos, calls, THRESHOLDS, clocks("06:28", "06:28"));
  check("1분 안이면 확률이 낮아도 잇는다", joined.length === 1, `묶음 ${joined.length}개`);

  const apart = buildGroups(photos, calls, THRESHOLDS, clocks("06:28", "06:40"));
  check("멀리 떨어진 시각이면 나눈다", apart.length === 2, `묶음 ${apart.length}개`);

  const off = buildGroups(photos, calls, NO_TIME, clocks("06:28", "06:28"));
  check("시각 규칙을 끄면 예전처럼 확률만 본다", off.length === 2, `묶음 ${off.length}개`);

  const unknownTime = buildGroups(photos, calls, THRESHOLDS, clocks("06:28", ""));
  check("시각을 모르면 가까운 시각으로 치지 않는다", unknownTime.length === 2, `묶음 ${unknownTime.length}개`);
}

// ── ⑩ 주소판은 자리의 증거이지 갈래의 증거가 아니다. 갈래 투표에서 뺀다.
//     빼지 않으면 작업 사진 한 장 + 주소판 한 장에서 갈래가 반으로 깎여 「모르겠음」이 된다.
{
  const photos = [described(0), described(1, "○○로12길 34")];
  const calls = [
    judged(0, "waste_cleanup", { top: 0.99 }),
    judged(1, "none_of_these", { top: 0.92, sameLocation: 0.9, addressPlate: 0.93 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("09:46", "09:46"));

  check("주소판은 갈래 투표에서 뺀다", groups[0]?.lane === "waste_cleanup", groups[0]?.lane);
  check("그 주소가 일지에 실린다", groups[0]?.address === "○○로12길 34", groups[0]?.address);

  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const waste = report.blocks.find((b) => b.key === "waste_cleanup");
  check("일지 문장에 주소가 들어간다", waste?.text.includes("○○로12길 34"), waste?.text);
}

// ── ⑩-2 묶음이 주소판뿐이면 뺄 것이 없다. 그건 정말 「모르겠음」이 맞다.
{
  const photos = [described(0, "○○로12길 34")];
  const calls = [judged(0, "none_of_these", { top: 0.99, addressPlate: 0.95 })];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  check("주소판뿐인 묶음은 모르겠음", groups[0]?.lane === "unknown", groups[0]?.lane);
}

// ── ⑪ 묶음의 갈래는 가장 센 한 장이 정한다. 치운 뒤 사진이 「아무것도 아님」인 것은
//     맞는 답이지 반증이 아니다. 평균을 내면 0.98 이 0.49 로 깎여 「모르겠음」이 됐다.
{
  const photos = [described(0), described(1), described(2, "○○로12길 34")];
  const before = judged(0, "waste_cleanup", { top: 0.98 });
  const after = judged(1, "none_of_these", { top: 1, sameLocation: 0.9, stage: "after" });
  const plate = judged(2, "none_of_these", { top: 1, sameLocation: 0.9, addressPlate: 0.95 });

  const groups = buildGroups(photos, [before, after, plate], THRESHOLDS, clocks("09:30", "09:30", "09:31"));
  check("한 자리 석 장이 한 묶음", groups.length === 1, `묶음 ${groups.length}개`);
  check("치운 뒤 사진이 갈래를 깎지 않는다", groups[0]?.lane === "waste_cleanup", groups[0]?.lane);
  check("그 자리의 주소가 남는다", groups[0]?.address === "○○로12길 34", groups[0]?.address);
}

// ── ⑪-2 그 한 장조차 분명하지 않으면 비워 둔다. 한 장만 보고 정하니 그 한 장은 분명해야 한다.
{
  const photos = [described(0), described(1)];
  const calls = [
    judged(0, "risk_facility", { top: 0.66 }),
    judged(1, "none_of_these", { top: 1, sameLocation: 0.9 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("09:30", "09:30"));
  check("문턱 아래 한 장은 모르겠음", groups[0]?.lane === "unknown", groups[0]?.lane);
}

// ── ⑫ 주소판 글자는 두 줄로 온다(도로명 / 번호). 일지 문장 한가운데서 줄이 끊기면 안 된다.
{
  const photos = [described(0), described(1, "○○로12길\n34")];
  const calls = [
    judged(0, "waste_cleanup", { top: 0.95 }),
    judged(1, "none_of_these", { top: 1, sameLocation: 0.9, addressPlate: 0.95 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("09:30", "09:30"));
  check("주소의 줄바꿈을 편다", groups[0]?.address === "○○로12길 34", JSON.stringify(groups[0]?.address));

  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const line = report.full.split("\n").find((row) => row.includes("○○로12길"));
  check("일지 문장 한 줄 안에 주소가 온전히 있다", line?.includes("○○로12길 34"), line);
}

// ── ⑬ 받은 부서 양식 그대로인지. 줄머리와 말이 한 칸이라도 어긋나면 복붙이 어그러진다.
{
  const photos = [described(0), described(1, "○○로12길 34"), described(2)];
  const calls = [
    judged(0, "waste_cleanup", { top: 0.95 }),
    judged(1, "none_of_these", { top: 1, sameLocation: 0.9, addressPlate: 0.95 }),
    judged(2, "risk_facility", { top: 0.95, sameLocation: 0.1 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("09:30", "09:30", "10:40"));
  const report = buildReport({
    dong: "○○동",
    date: "2026-05-12",
    groups,
    seasonalSpots: ["○○공원 앞"],
  });

  const lines = report.full.split("\n");
  const has = (line) => lines.includes(line);

  check("순찰사항 제목 줄", has("  ○ 이면도로 청소 및 도로변 정비"), lines.join(" / "));
  check("순찰사항 대표 줄", has("    - ○○로12길 34 폐기물 처리 및 수거"), lines.join(" / "));
  check("위험시설물 란 이름", has("□ 위험시설물 순찰사항"));
  check("위험시설물 건수 줄", has("    - 현장확인: 1건, 특이사항: 없음"));
  check("위험시설물 자리 줄", has("     · 주소 미기재 현장 확인"));
  check("통보 적을 자리를 비워 둔다", has("       ※ ") && has("         → "));
  check("계절특수 란 이름", has("□ 계절특수 순찰사항"));
  check("고정 지점은 설정 그대로", has("     · ○○공원 앞"));
  check("고정 지점 건수 줄", has("    - 현장확인: 1건 , 특이사항: 없음"));
}

// ── ⑭ 사람이 고친 말을 다음에도 쓴다. 다만 배우는 것은 말이지 틀이 아니다.
{
  const photos = [described(0), described(1)];
  const calls = [
    judged(0, "waste_cleanup", { top: 0.95 }),
    judged(1, "waste_cleanup", { top: 0.95, sameLocation: 0.1 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  const made = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });

  const edited = made.full
    .replace("  ○ 이면도로 청소 및 도로변 정비", "  ○ 골목 청소 및 환경미화")
    .replace(/폐기물 처리 및 수거/g, "생활쓰레기 수거");
  const learned = learnWording(made.full, edited, DEFAULT_WORDING);

  check("제목을 배운다", learned.patrolHeading === "골목 청소 및 환경미화", JSON.stringify(learned));
  check("자리 문구를 배운다", learned.patrolWork === "생활쓰레기 수거", JSON.stringify(learned));

  const again = buildReport({
    dong: "○○동",
    date: "2026-05-13",
    groups,
    seasonalSpots: [],
    wording: learned,
  });
  check("다음 회차에 그 말로 적는다", again.full.includes("  ○ 골목 청소 및 환경미화"));

  // 줄을 넣었으면 어느 자리가 어느 자리인지 알 수 없다. 잘못 배우느니 안 배운다.
  const withExtraLine = `${made.full}\n  ○ 덧붙인 줄`;
  const nothing = learnWording(made.full, withExtraLine, DEFAULT_WORDING);
  check("줄 수가 달라지면 배우지 않는다", Object.keys(nothing).length === 0, JSON.stringify(nothing));

  // 주소는 그날 값이다. 배우면 다음 날 남의 주소가 따라온다.
  const addressEdited = made.full.replace("주소 미기재 2개소", "○○로9길 1");
  const noAddress = learnWording(made.full, addressEdited, DEFAULT_WORDING);
  check("주소는 배우지 않는다", noAddress.patrolWork === undefined, JSON.stringify(noAddress));
}

// ── ⑮ 자리마다 다른 말. 한 자리만 다른 일을 한 날이 있다(경고스티커 부착처럼).
{
  const photos = [described(0, "○○로12길 34"), described(1, "○○로34길 5")];
  const calls = [
    judged(0, "waste_cleanup", { top: 0.95, addressPlate: 0.9 }),
    judged(1, "waste_cleanup", { top: 0.95, sameLocation: 0.1, addressPlate: 0.9 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  groups[1].work = "폐기물 경고스티커 부착";

  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const waste = report.blocks.find((b) => b.key === "waste_cleanup");

  check(
    "정한 자리는 그 말로 적는다",
    waste?.text.includes("· ○○로34길 5 폐기물 경고스티커 부착"),
    waste?.text,
  );
  check(
    "안 정한 자리는 기본 문구 그대로",
    waste?.text.includes("· ○○로12길 34 폐기물 처리 및 수거"),
    waste?.text,
  );
}


// ── ⑭ 주소판을 자리 **앞**에 찍는 사람. 첫 장이 주소판이면 그렇게 읽는다.
//     실물 18장에서 이것 때문에 자리가 통째로 한 장씩 밀리고 주소가 옆자리 것이 됐다.
{
  const photos = [
    described(0, "○○로12길 34"), described(1), described(2),
    described(3, "○○로34길 5"), described(4), described(5),
  ];
  // 치우기 전과 치운 뒤는 캡션이 달라 같은자리 확률이 낮게 나온다(실측 중앙값 0.20).
  const calls = [
    judged(0, "none_of_these", { addressPlate: 0.95 }),
    judged(1, "waste_cleanup", { sameLocation: 0.2 }),
    judged(2, "waste_cleanup", { sameLocation: 0.2 }),
    judged(3, "none_of_these", { addressPlate: 0.95, sameLocation: 0.2 }),
    judged(4, "waste_cleanup", { sameLocation: 0.2 }),
    judged(5, "waste_cleanup", { sameLocation: 0.2 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  const shape = groups.map((g) => g.photos.join("")).join(" / ");

  check("주소판이 첫 장이면 자리의 앞으로 읽는다", groups.length === 2, shape);
  check("한 장씩 밀리지 않는다", groups[0]?.photos.join(",") === "0,1,2", shape);
  check("앞 주소판의 주소가 그 자리에 붙는다", groups[0]?.address === "○○로12길 34", groups[0]?.address);
  check("옆자리 주소를 물려받지 않는다", groups[1]?.address === "○○로34길 5", groups[1]?.address);
}

// ── ⑮ 주소판이 정해 준 자리는 같은자리 확률로 더 쪼개지 않는다.
//     확률은 캡션만 보고 내는 값이라, 그 값으로 주소판이 그은 선을 다시 그으면 자리가 밀린다.
{
  const photos = [described(0), described(1), described(2, "○○로12길 34")];
  const calls = [
    judged(0, "waste_cleanup"),
    judged(1, "waste_cleanup", { sameLocation: 0.11 }),
    judged(2, "none_of_these", { addressPlate: 0.95, sameLocation: 0.11 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  check("주소판 구간은 확률이 낮아도 한 자리", groups.length === 1, groups.map((g) => g.photos.join("")).join(" / "));
  check("그 자리에 주소가 붙는다", groups[0]?.address === "○○로12길 34", groups[0]?.address);
}

// ── ⑯ 시각이 크게 벌어지면 주소판보다 세다. 같은 주소판 앞이어도 나눈다.
{
  const photos = [described(0), described(1), described(2, "○○로12길 34")];
  const calls = [
    judged(0, "waste_cleanup"),
    judged(1, "waste_cleanup", { sameLocation: 0.9 }),
    judged(2, "none_of_these", { addressPlate: 0.95, sameLocation: 0.9 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("09:00", "09:01", "10:30"));
  check("한 시간 반 벌어지면 주소판 앞이어도 나눈다", groups.length === 2, groups.map((g) => g.photos.join("")).join(" / "));
  check("앞 자리는 주소가 없다", groups[0]?.address === "", JSON.stringify(groups[0]?.address));
}

// ── ⑰ 주소판이 하나도 없는 덩이에서만 확률을 쓴다. 애매하면 나눈다.
{
  const photos = [described(0), described(1), described(2)];
  const calls = [
    judged(0, "waste_cleanup"),
    judged(1, "waste_cleanup", { sameLocation: 0.2 }),
    judged(2, "waste_cleanup", { sameLocation: 0.9 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  check("주소판이 없으면 확률이 나눈다", groups.length === 2, groups.map((g) => g.photos.join("")).join(" / "));
  check("문턱 넘은 장은 앞에 붙는다", groups[1]?.photos.join(",") === "1,2", groups[1]?.photos.join(","));
}

// ── ⑱ 판정이 아예 없으면(키 없이 도는 경우) 장수로 끊는다. 마지막 수단이다.
{
  const photos = [0, 1, 2, 3].map((i) => described(i));
  const groups = buildGroups(photos, [], THRESHOLDS, {}, 3);
  check("판정이 없으면 장수로 끊는다", groups.length === 2, groups.map((g) => g.photos.join("")).join(" / "));
  check("앞 자리가 세 장", groups[0]?.photos.length === 3, String(groups[0]?.photos.length));
}

// ── ⑲ 주소판이 앞인지 뒤인지 읽는 규칙 자체.
{
  check("첫 장이 주소판이면 앞", wherePlate([true, false, false, true, false, false]) === "leading");
  check("끝 장이 주소판이면 뒤", wherePlate([false, false, true, false, false, true]) === "trailing");
  check("주소판이 없으면 뒤로 본다", wherePlate([false, false, false]) === "trailing");
  check("빈 목록도 견딘다", wherePlate([]) === "trailing");
  // 양끝이 다 주소판이면 더 재 봐야 갈라지지 않는다. 흔한 버릇(뒤)으로 둔다.
  check(
    "양끝이 주소판이면 흔한 버릇으로",
    wherePlate([true, false, false, true, false, false, true]) === "trailing",
  );
}


// ── ⑳ 주소판 글자가 적혀 왔으면 확률이 낮아도 주소판이다.
//     확률 하나만 보면 한 장을 놓치는 날이 있고, 그 한 장 때문에 두 자리가 한 자리로 붙는다.
{
  const photos = [
    described(0, "○○로12길 34"), described(1), described(2),
    described(3, "○○로34길 5"), described(4), described(5),
  ];
  const calls = [
    judged(0, "none_of_these", { addressPlate: 0.95 }),
    judged(1, "waste_cleanup", { sameLocation: 0.2 }),
    judged(2, "waste_cleanup", { sameLocation: 0.2 }),
    // 이 장은 주소판인데 Jev 가 문턱 아래로 봤다. 모델은 주소판 글자를 적어 왔다.
    judged(3, "none_of_these", { addressPlate: 0.3, sameLocation: 0.2 }),
    judged(4, "waste_cleanup", { sameLocation: 0.2 }),
    judged(5, "waste_cleanup", { sameLocation: 0.2 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {}, 3);
  const shape = groups.map((g) => g.photos.join("")).join(" / ");
  check("확률을 놓쳐도 주소판 글자가 자리를 가른다", groups.length === 2, shape);
  check("여섯 장이 한 자리로 붙지 않는다", groups[0]?.photos.length === 3, shape);
  check("두 번째 자리도 제 주소", groups[1]?.address === "○○로34길 5", groups[1]?.address);
}

// ── ㉑ 그래도 주소판을 통째로 놓치면(흐리게 찍혔다) 자리가 두 몫만큼 길어진다.
//     그때는 주소판 쪽에서부터 장수로 끊는다. 확률로 끊으면 중앙값 0.20 이라 낱장으로 흩어진다.
{
  const photos = [
    described(0, "○○로12길 34"), described(1), described(2),
    described(3), described(4), described(5),
  ];
  const calls = [
    judged(0, "none_of_these", { addressPlate: 0.95 }),
    ...[1, 2, 3, 4, 5].map((i) => judged(i, "waste_cleanup", { sameLocation: 0.2 })),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {}, 3);
  const shape = groups.map((g) => g.photos.join("")).join(" / ");
  check("두 자리 몫보다 길면 장수로 끊는다", groups.length === 2, shape);
  check("주소판이 든 조각이 앞", groups[0]?.photos.join(",") === "0,1,2", shape);
  check("주소는 주소판이 든 조각에만", groups[0]?.address === "○○로12길 34" && groups[1]?.address === "");
}

// ── ㉒ 앞뒤 낱장에 읽기가 뒤집히지 않는다. 청소와 상관없는 사진이 섞여도 견뎌야 한다.
{
  // 주소판이 자리 앞인 사람의 사진 앞에, 주소판도 작업도 아닌 사진 한 장이 끼었다.
  check(
    "앞에 낱장이 끼어도 앞으로 읽는다",
    wherePlate([false, true, false, false, true, false, false]) === "leading",
  );
  check(
    "뒤에 낱장이 끼어도 뒤로 읽는다",
    wherePlate([false, false, true, false, false, true, false]) === "trailing",
  );
}


// ── ㉓ 청소와 상관없는 사진이 섞이면 그 자리만 길어진다. 그날의 리듬이 잣대가 된다.
//     그대로 두면 **딴 사진이 남의 주소를 물려받는다** — 실물에서 그랬다.
{
  // 석 장 리듬으로 세 자리, 마지막 자리 뒤에 딴 사진 두 장.
  const photos = [
    described(0, "○○로12길 34"), described(1), described(2),
    described(3, "○○로34길 5"), described(4), described(5),
    described(6, "○○로9길 1"), described(7), described(8),
    described(9), described(10),
  ];
  const calls = [
    judged(0, "none_of_these", { addressPlate: 0.95 }),
    judged(3, "none_of_these", { addressPlate: 0.95, sameLocation: 0.2 }),
    judged(6, "none_of_these", { addressPlate: 0.95, sameLocation: 0.2 }),
    ...[1, 2, 4, 5, 7, 8, 9, 10].map((i) => judged(i, "waste_cleanup", { sameLocation: 0.2 })),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {}, 3);
  const shape = groups.map((g) => g.photos.length).join("-");

  check("리듬보다 긴 자리는 리듬만큼만 남긴다", shape === "3-3-3-2", shape);
  check("딴 사진은 주소 없는 자리로 떨어진다", groups[3]?.address === "", JSON.stringify(groups[3]?.address));
  check("남의 주소를 물려받지 않는다", groups[2]?.photos.join(",") === "6,7,8", groups[2]?.photos.join(","));
}

// ── ㉔ 자리 길이가 들쭉날쭉하면 리듬으로 치지 않는다. 억지 리듬은 멀쩡한 자리를 자른다.
{
  const photos = [
    described(0, "○○로12길 34"), described(1),
    described(2, "○○로34길 5"), described(3), described(4),
    described(5, "○○로9길 1"), described(6), described(7), described(8),
  ];
  const calls = [
    judged(0, "none_of_these", { addressPlate: 0.95 }),
    judged(2, "none_of_these", { addressPlate: 0.95, sameLocation: 0.2 }),
    judged(5, "none_of_these", { addressPlate: 0.95, sameLocation: 0.2 }),
    ...[1, 3, 4, 6, 7, 8].map((i) => judged(i, "waste_cleanup", { sameLocation: 0.2 })),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {}, 3);
  const shape = groups.map((g) => g.photos.length).join("-");
  check("과반이 아니면 리듬으로 안 자른다", shape === "2-3-4", shape);
}

if (problems.length > 0) {
  console.error(`\n${checked - problems.length}/${checked} 통과 · 실패 ${problems.length}건`);
  for (const problem of problems) console.error(`  → ${problem}`);
  process.exit(1);
}

console.log(`\n${checked}/${checked} 통과`);
