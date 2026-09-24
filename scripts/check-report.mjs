/**
 * 묶기와 일지 문장 회귀 검사.
 *
 * **API 를 부르지 않습니다.** 사진도, 키도, 인터넷도 필요 없습니다. 판정은 이미 났다고 치고,
 * 그 뒤를 봅니다. 어디서 묶음이 갈리는지, 어떤 문장이 나오는지, 그리고 같은 입력이
 * 늘 같은 글자를 내는지. README 가 「같은 사진이면 늘 같은 글」이라고 적었으니 그걸 지킵니다.
 *
 *   npm run check:report      (노드 22 이상)
 *
 * 여기 들어가는 값은 전부 지어낸 것입니다. 실물 사진도, 실제 지명도 들어가지 않습니다.
 */

import { buildGroups, wherePlate } from "../src/core/group.ts";
import { buildReport, DEFAULT_WORDING, learnWording } from "../src/core/report.ts";
import { stampFromClock } from "../src/core/shot-time.ts";

const THRESHOLDS = { lane: 0.8, sameLocation: 0.5, addressPlate: 0.7, sameMinutes: 2, splitMinutes: 5, workShot: 0.8 };
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
    stageProbabilities: extra.stageProbabilities ?? {},
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
  // 「주소 미기재 2개소 등 2개소」. 같은 말을 두 번 하던 자리다.
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
  // 양끝이 다 주소판이면 첫 장을 본다. 자리 경계에서 사진이 딱 잘리면 이렇게 된다.
  check(
    "양끝이 주소판이면 첫 장이 정한다",
    wherePlate([true, false, false, true, false, false, true]) === "leading",
  );
  check(
    "양끝이 주소판이 아니면 흔한 버릇으로",
    wherePlate([false, true, false, false, true, false]) === "trailing",
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
//     그대로 두면 **딴 사진이 남의 주소를 물려받는다**. 실물에서 그랬다.
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


// ── ㉕ 자리 경계에서 사진이 딱 잘렸을 때. 맛보기가 앞 열 장만 읽으면 실제로 이렇게 된다.
//     석 장 리듬이면 열 장째가 주소판이라 **양 끝이 다 주소판**이 되고, 읽기가 뒤집힐 뻔한 자리다.
{
  const photos = [
    described(0, "○○로12길 34"), described(1), described(2),
    described(3, "○○로34길 5"), described(4), described(5),
    described(6, "○○로9길 1"),
  ];
  const calls = [
    judged(0, "none_of_these", { addressPlate: 0.95 }),
    judged(3, "none_of_these", { addressPlate: 0.95, sameLocation: 0.2 }),
    judged(6, "none_of_these", { addressPlate: 0.95, sameLocation: 0.2 }),
    ...[1, 2, 4, 5].map((i) => judged(i, "waste_cleanup", { sameLocation: 0.2 })),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, {}, 3);
  const shape = groups.map((g) => g.photos.length).join("-");

  check("잘려도 앞의 자리들은 온전하다", shape === "3-3-1", shape);
  check("첫 자리가 주소판 한 장이 되지 않는다", groups[0]?.photos.length === 3, shape);
  check("주소가 옆자리로 밀리지 않는다", groups[0]?.address === "○○로12길 34", groups[0]?.address);
  check("잘린 자국은 맨 끝에 남는다", groups[2]?.address === "○○로9길 1", groups[2]?.address);
}

// ── ㉖ 치운 뒤 사진 구석의 길 표지판을 모델이 글자로 적어 온 날. 그 장은 주소판이 아니다.
//     Jev 가 「후」라고 분명히 봤으면 글자가 있어도 자리를 거기서 끊지 않는다.
//     실물 30장에서 자리 넷째의 후 사진이 이렇게 읽혀 진짜 주소판이 혼자 다섯째 연번이 됐다.
{
  const photos = [
    described(0), described(1), described(2, "○○로12길 34"),
    described(3), described(4, "○○로35길"), described(5, "○○로16길 9"),
  ];
  const sure = (stage) => ({ stage, stageProbabilities: { before: 0, after: 0, not_applicable: 0, [stage]: 0.9 } });
  const calls = [
    judged(0, "waste_cleanup", sure("before")),
    judged(1, "waste_cleanup", { sameLocation: 0.7, ...sure("after") }),
    judged(2, "none_of_these", { sameLocation: 0.3, addressPlate: 0.97, ...sure("not_applicable") }),
    judged(3, "waste_cleanup", { sameLocation: 0.2, ...sure("before") }),
    judged(4, "waste_cleanup", { sameLocation: 0.3, addressPlate: 0.91, ...sure("after") }),
    judged(5, "none_of_these", { sameLocation: 0.3, addressPlate: 0.98, ...sure("not_applicable") }),
  ];
  const times = clocks("07:40", "07:41", "07:41", "07:43", "07:44", "07:44");
  const groups = buildGroups(photos, calls, THRESHOLDS, times);
  const shape = groups.map((g) => g.photos.length).join("-");

  check("후 사진에 읽힌 글자는 자리를 끊지 않는다", shape === "3-3", shape);
  check("주소는 진짜 주소판에서 온다", groups[1]?.address === "○○로16길 9", groups[1]?.address);
  check("길 표지판 글자는 주소가 되지 않는다", groups.every((g) => g.address !== "○○로35길"));

  // 확률이 없는 옛 판정은 전·후 규칙을 안 탄다. 대신 같은 분 안에 붙은 주소판 둘은 주소판 확률로 견줘
  // 하나만 남기므로(0.91 vs 0.98) 여기서도 자리는 둘이다. 옛 판정도 옆집 주소를 물려받지 않는다.
  const old = calls.map((c) => ({ ...c, stageProbabilities: {} }));
  const oldGroups = buildGroups(photos, old, THRESHOLDS, times);
  const before = oldGroups.map((g) => g.photos.length).join("-");
  check("확률 없는 판정도 붙은 주소판은 하나로 본다", before === "3-3", before);
  check("확률 없는 판정도 주소는 진짜 주소판 것", oldGroups[1]?.address === "○○로16길 9", oldGroups[1]?.address);
}

// ── ㉗ 올라온 차례가 찍은 차례와 거꾸로인데(폰 사진첩은 최신이 앞) 시각은 다 아는 날.
//     시각순으로 줄을 세워 묶는다. 올라온 차례 그대로면 간격이 전부 음수라 장마다 끊긴다.
{
  // 올린 차례: 주소판(07:44) · 후(07:44) · 전(07:43) · 주소판(07:41) · 후(07:41) · 전(07:40)
  const photos = [
    described(0, "○○로16길 9"), described(1), described(2),
    described(3, "○○로12길 34"), described(4), described(5),
  ];
  const calls = [
    judged(0, "none_of_these", { addressPlate: 0.97 }),
    judged(1, "waste_cleanup", { sameLocation: 0.3 }),
    judged(2, "waste_cleanup", { sameLocation: 0.7 }),
    judged(3, "none_of_these", { sameLocation: 0.2, addressPlate: 0.97 }),
    judged(4, "waste_cleanup", { sameLocation: 0.3 }),
    judged(5, "waste_cleanup", { sameLocation: 0.7 }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("07:44", "07:44", "07:43", "07:41", "07:41", "07:40"));
  const shape = groups.map((g) => g.photos.join(",")).join(" / ");

  check("시각을 다 알면 시각순으로 묶는다", shape === "5,4,3 / 2,1,0", shape);
  check("이른 자리가 첫 자리다", groups[0]?.address === "○○로12길 34", groups[0]?.address);

  // 시각을 모르는 장은 아는 장 사이에 꽂지 않고 맨 뒤에 따로 둔다. 아는 장들은 그대로 시각순.
  const partly = buildGroups(photos, calls, THRESHOLDS, clocks("07:44", "07:44", "", "07:41", "07:41", "07:40"));
  const partlyShape = partly.map((g) => g.photos.join(",")).join(" / ");
  check("시각 모르는 장은 뒤로 빼고 따로 둔다", partlyShape === "5,4,3 / 1,0 / 2", partlyShape);
}

// ── ㉘ 갈래가 갈리면 끊는다. 청소 자리를 끝내고 걸어가다 그늘막을 한 장 찍으면(2분 안)
//     시각 잇기가 그 자리에 붙였고, 그 뒤 청소 자리는 그늘막을 앞에 달고 시작했다.
{
  // 앞에 찍는 사람: 주소판 · 전 · 후 · 그늘막(1분 뒤) · 주소판 · 전 · 후
  const shade = { ...described(3), caption: "A public sunshade canopy over a crossing, folded.", captionKo: "횡단보도 위 그늘막" };
  const photos = [
    described(0, "○○로12길 34"), described(1), described(2), shade,
    described(4, "○○로16길 9"), described(5), described(6),
  ];
  const calls = [
    judged(0, "none_of_these", { addressPlate: 0.97 }),
    judged(1, "waste_cleanup", { sameLocation: 0.7, stage: "before", stageProbabilities: { before: 0.9 } }),
    judged(2, "none_of_these", { sameLocation: 0.6, stage: "after", stageProbabilities: { after: 0.9 } }),
    judged(3, "flood_season", { sameLocation: 0.4, stage: "not_applicable", stageProbabilities: { not_applicable: 0.95 } }),
    judged(4, "none_of_these", { sameLocation: 0.2, addressPlate: 0.97 }),
    judged(5, "waste_cleanup", { sameLocation: 0.7, stage: "before", stageProbabilities: { before: 0.9 } }),
    judged(6, "none_of_these", { sameLocation: 0.6, stage: "after", stageProbabilities: { after: 0.9 } }),
  ];
  const times = clocks("09:00", "09:01", "09:03", "09:04", "09:05", "09:06", "09:08");
  const groups = buildGroups(photos, calls, THRESHOLDS, times);
  const shape = groups.map((g) => g.photos.join(",")).join(" / ");

  check("갈래가 갈리면 2분 안이어도 끊는다", shape === "0,1,2 / 3 / 4,5,6", shape);
  check("그늘막 자리는 계절특수", groups[1]?.lane === "flood_season", groups[1]?.lane);
  check("그늘막 자리는 주소를 안 물려받는다", groups[1]?.address === "", groups[1]?.address);
  check("그늘막 자리라고 표시된다", groups[1]?.shade === true, `${groups[1]?.shade}`);
  check("치운 뒤 사진이 「모르겠음」이어도 자리는 안 갈라진다", groups[0]?.photos.length === 3, shape);

  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const flood = report.blocks.find((b) => b.key === "flood_season");
  check("그늘막은 점검 문장", flood?.text.includes(DEFAULT_WORDING.shadeWork), flood?.text);
  check("그늘막에 배수구 말을 안 쓴다", !flood?.text.includes(DEFAULT_WORDING.drainWork), flood?.text);

  // 뒤에 찍는 사람도 같다: 전 · 후 · 주소판 · 그늘막 · 전 · 후 · 주소판. 그늘막이 다음 자리 주소를 물려받으면 안 된다.
  const trailingPhotos = [
    described(0), described(1), described(2, "○○로12길 34"), shade,
    described(4), described(5), described(6, "○○로16길 9"),
  ];
  const trailingCalls = [calls[1], calls[2], calls[0], calls[3], calls[5], calls[6], calls[4]].map((one, index) => ({ ...one, index }));
  const trailing = buildGroups(trailingPhotos, trailingCalls, THRESHOLDS, times);
  const trailingShape = trailing.map((g) => g.photos.join(",")).join(" / ");
  check("뒤에 찍는 사람도 그늘막이 다음 자리에 안 붙는다", trailingShape === "0,1,2 / 3 / 4,5,6", trailingShape);
  check("그 자리 주소는 뒤 자리 것", trailing[2]?.address === "○○로16길 9", trailing[2]?.address);

  // 갈래가 문턱 아래면 예전처럼 시각이 잇는다. 애매한 한 장으로 자리를 가르지 않는다.
  const faint = calls.map((one) => (one.index === 3 ? judged(3, "flood_season", { top: 0.6, sameLocation: 0.4, stage: "not_applicable", stageProbabilities: { not_applicable: 0.95 } }) : one));
  const joined = buildGroups(photos, faint, THRESHOLDS, times).map((g) => g.photos.join(",")).join(" / ");
  check("갈래가 문턱 아래면 안 끊는다", joined === "0,1,2,3 / 4,5,6", joined);
}

// ── ㉙ 배수구 자리는 그대로 배수구 말. 그늘막 말은 캡션에 그늘막이 있을 때만.
{
  const photos = [{ ...described(0), caption: "A storm drain grate at the kerb, clogged with leaves." }];
  const calls = [judged(0, "flood_season")];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  check("배수구 자리는 표시가 없다", groups[0]?.shade === undefined, `${groups[0]?.shade}`);
  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const flood = report.blocks.find((b) => b.key === "flood_season");
  check("배수구는 배수구 말", flood?.text.includes(DEFAULT_WORDING.drainWork), flood?.text);

  // 사람이 그늘막 문장을 고치면 그 말을 배운다. 배수구 말과 따로. (주소 뒤의 말만 배우는 것은 배수구와 같다.)
  const shaded = buildReport({ dong: "○○동", date: "2026-05-12", groups: [{ ...groups[0], shade: true, address: "○○로12길 34" }], seasonalSpots: [] });
  const edited = shaded.full.replace(DEFAULT_WORDING.shadeWork, "그늘막 작동 확인");
  const learned = learnWording(shaded.full, edited, DEFAULT_WORDING);
  check("그늘막 말을 따로 배운다", learned.shadeWork === "그늘막 작동 확인" && learned.drainWork === undefined, JSON.stringify(learned));
}

// ── ㉚-0 그늘막 사진은 Jev 가 「모르겠음」이어도 캡션의 그늘막 말로 계절특수가 된다.
{
  const photos = [{ ...described(0), caption: "A covered bus shelter stands beside a paved sidewalk." }, described(1)];
  const calls = [judged(0, "none_of_these", { top: 0.6 }), judged(1, "none_of_these", { top: 0.9, sameLocation: 0.1 })];
  const groups = buildGroups(photos, calls, THRESHOLDS, {});
  check("모르겠음 + 그늘막 캡션 = 계절특수·그늘막", groups[0]?.lane === "flood_season" && groups[0]?.shade === true, `${groups[0]?.lane} ${groups[0]?.shade}`);
  check("그늘막 말 없는 모르겠음은 그대로", groups[1]?.lane === "unknown", groups[1]?.lane);
  const sure = buildGroups(photos, [judged(0, "risk_facility", { top: 0.95 }), calls[1]], THRESHOLDS, {});
  check("Jev 가 분명히 정한 갈래는 안 건드린다", sure[0]?.lane === "risk_facility", sure[0]?.lane);
}

// ── ㉚ 위험시설물 자리의 말을 쉼표로 나눠 적으면 · 줄, ※ 줄, → 줄에 차례로 들어간다.
{
  const groups = [{ id: "a", photos: [0], address: "○○동 297-28", lane: "risk_facility", edited: true, time: "",
    work: "○○동 297-28 도로 파손 확인, 스마트불편신고(접수번호: 20260924111072), 기 조치 요청한 곳으로 경과 관찰" }];
  const report = buildReport({ dong: "○○동", date: "2026-05-12", groups, seasonalSpots: [] });
  const text = report.blocks.find((b) => b.key === "risk_facility")?.text ?? "";
  check("· 줄에 첫 조각", text.includes("     · ○○동 297-28 ○○동 297-28 도로 파손 확인\n"), text);
  check("※ 줄에 둘째 조각(괄호 안 쉼표는 안 나눔)", text.includes("       ※ 스마트불편신고(접수번호: 20260924111072)\n"), text);
  check("→ 줄에 셋째 조각", text.includes("         → 기 조치 요청한 곳으로 경과 관찰"), text);
  const plain = buildReport({ dong: "○○동", date: "2026-05-12", groups: [{ ...groups[0], work: "" }], seasonalSpots: [] });
  const plainText = plain.blocks.find((b) => b.key === "risk_facility")?.text ?? "";
  check("쉼표가 없으면 ※ · → 는 비워 둔다", plainText.includes("       ※ \n         → "), plainText);
}

// ── ㉛ 치운 뒤 사진이 배수구 때문에 「계절특수」 0.8 로 나와도 자리를 가르지 않는다.
//     갈래로 끊는 것은 확인 사진(전·후 「해당 없음」)뿐이다. 실물 12번 장이 그랬다.
{
  const photos = [described(0), described(1), described(2)];
  const calls = [
    judged(0, "waste_cleanup", { top: 0.96, stage: "before", stageProbabilities: { before: 0.63, after: 0.35 } }),
    judged(1, "flood_season", { top: 0.81, sameLocation: 0.12, stage: "after", stageProbabilities: { after: 0.52, not_applicable: 0.48 } }),
    judged(2, "none_of_these", { sameLocation: 0.17, stage: "not_applicable", stageProbabilities: { not_applicable: 0.89 } }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("08:08", "08:08", "08:09"));
  const shape = groups.map((g) => g.photos.join(",")).join(" / ");
  check("후 사진이 다른 갈래로 나와도 자리는 하나", shape === "0,1,2", shape);
  check("그 자리는 순찰사항", groups[0]?.lane === "waste_cleanup", groups[0]?.lane);
}

// ── ㉜ 같은 분 안에 주소판이 둘 붙으면 더 분명한 쪽만 주소판. 후 사진 구석의 옆집 주소판(글자 읽힘 ·
//     후 0.66)이 진짜 주소판(「해당 없음」 0.94) 바로 앞에 있던 실물 24·23번 장.
{
  const photos = [described(0), described(1, "△△로28길 12"), described(2, "○○로16길 9"), described(3), described(4), described(5, "○○로16길 17")];
  const calls = [
    judged(0, "waste_cleanup", { top: 1.0, stage: "before", stageProbabilities: { before: 0.97 } }),
    judged(1, "flood_season", { top: 0.82, sameLocation: 0.1, addressPlate: 0.92, stage: "after", stageProbabilities: { after: 0.66, not_applicable: 0.34 } }),
    judged(2, "none_of_these", { sameLocation: 0.31, addressPlate: 0.98, stage: "not_applicable", stageProbabilities: { not_applicable: 0.94 } }),
    judged(3, "waste_cleanup", { top: 0.9, sameLocation: 0.2, stage: "before", stageProbabilities: { before: 0.9 } }),
    judged(4, "none_of_these", { sameLocation: 0.6, stage: "after", stageProbabilities: { after: 0.9 } }),
    judged(5, "none_of_these", { sameLocation: 0.2, addressPlate: 0.96, stage: "not_applicable", stageProbabilities: { not_applicable: 0.95 } }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("07:40", "07:41", "07:41", "07:43", "07:44", "07:44"));
  const shape = groups.map((g) => g.photos.join(",")).join(" / ");
  check("붙은 주소판 둘은 한 자리", shape === "0,1,2 / 3,4,5", shape);
  check("주소는 진짜 주소판 것", groups[0]?.address === "○○로16길 9", groups[0]?.address);
  check("옆집 주소가 붙지 않는다", groups.every((g) => g.address !== "△△로28길 12"), shape);
  check("첫 자리는 순찰사항(전 1.00)", groups[0]?.lane === "waste_cleanup", groups[0]?.lane);
}

// ── ㉝ 갈래가 문턱에 조금 못 미쳐도 「치우기 전」이 분명하고 순찰사항이 제일 세면 순찰사항.
{
  const photos = [described(0), described(1), described(2, "○○로4길 18")];
  const calls = [
    judged(0, "waste_cleanup", { top: 0.71, stage: "before", stageProbabilities: { before: 0.95 } }),
    judged(1, "none_of_these", { top: 0.52, sameLocation: 0.22, stage: "after", stageProbabilities: { after: 0.79 } }),
    judged(2, "none_of_these", { sameLocation: 0.19, addressPlate: 0.97, stage: "not_applicable", stageProbabilities: { not_applicable: 0.93 } }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("07:11", "07:14", "07:14"));
  check("전 사진이 분명하면 순찰사항", groups.length === 1 && groups[0].lane === "waste_cleanup", groups.map((g) => `${g.photos.join(",")}:${g.lane}`).join(" / "));

  // 전 사진이어도 제일 센 갈래가 위험시설물이면 그대로 모르겠음(문턱 아래).
  const facility = [judged(0, "risk_facility", { top: 0.7, stage: "before", stageProbabilities: { before: 0.9 } })];
  const alone = buildGroups([described(0)], facility, THRESHOLDS, {});
  check("위험시설물 쪽 전 사진은 안 바꾼다", alone[0]?.lane === "unknown", alone[0]?.lane);
  // 셋 다 낮으면 전 사진이라도 모르겠음.
  const faint = [judged(0, "waste_cleanup", { top: 0.3, stage: "before", stageProbabilities: { before: 0.9 } })];
  const faintGroups = buildGroups([described(0)], faint, THRESHOLDS, {});
  check("순찰사항 확률이 문턱 반 아래면 안 바꾼다", faintGroups[0]?.lane === "unknown", faintGroups[0]?.lane);
}

// ── ㉞ 시각을 아는 장과 모르는 장이 섞인 날. 모르는 장은 뒤로 빼 따로 묶고, 아는 장의 주소판 앞뒤
//     판독을 흔들지 않는다(자료 사진 9장이 뒤에 붙어 「앞에 찍는 사람」으로 뒤집혔던 실물 39장).
{
  const photos = [described(0), described(1), described(2, "○○로4길 18"), described(3), described(4), described(5, "○○로4길 21"), described(6), described(7), described(8)];
  const calls = [
    judged(0, "waste_cleanup", { stage: "before", stageProbabilities: { before: 0.95 } }),
    judged(1, "none_of_these", { sameLocation: 0.2, stage: "after", stageProbabilities: { after: 0.8 } }),
    judged(2, "none_of_these", { sameLocation: 0.2, addressPlate: 0.97, stage: "not_applicable", stageProbabilities: { not_applicable: 0.93 } }),
    judged(3, "waste_cleanup", { sameLocation: 0.4, stage: "before", stageProbabilities: { before: 0.97 } }),
    judged(4, "none_of_these", { sameLocation: 0.4, stage: "after", stageProbabilities: { after: 0.8 } }),
    judged(5, "none_of_these", { sameLocation: 0.3, addressPlate: 0.95, stage: "not_applicable", stageProbabilities: { not_applicable: 0.93 } }),
    judged(6, "risk_facility", { sameLocation: 0.2, stage: "before", stageProbabilities: { before: 0.7 } }),
    judged(7, "risk_facility", { sameLocation: 0.1, stage: "before", stageProbabilities: { before: 0.7 } }),
    judged(8, "flood_season", { sameLocation: 0.1, stage: "not_applicable", stageProbabilities: { not_applicable: 0.9 } }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("07:11", "07:14", "07:14", "07:15", "07:16", "07:16", "", "", ""));
  const shape = groups.map((g) => g.photos.join(",")).join(" / ");
  check("아는 장은 자리대로, 모르는 장은 뒤에 낱장으로", shape === "0,1,2 / 3,4,5 / 6 / 7 / 8", shape);
  check("주소판이 뒤에 찍힌 것으로 읽는다(주소가 제자리)", groups[0]?.address === "○○로4길 18" && groups[1]?.address === "○○로4길 21", `${groups[0]?.address} / ${groups[1]?.address}`);
}

// ── ㉟ 치운 뒤 사진이 「해당 없음」 0.78 · 위험시설물 0.91 로 나온 날(실물 18번 장). 확신이 문턱 아래인
//     장은 확인 사진이 아니고, 앞 장이 분명한 「전」이면 그 자리의 후다. 자리도 갈래도 그대로다.
{
  const photos = [described(0), described(1), described(2, "○○로 53-4")];
  const calls = [
    judged(0, "waste_cleanup", { top: 0.98, stage: "before", stageProbabilities: { before: 0.95 } }),
    judged(1, "risk_facility", { top: 0.91, sameLocation: 0.3, stage: "not_applicable", stageProbabilities: { not_applicable: 0.78, before: 0.15 } }),
    judged(2, "none_of_these", { sameLocation: 0.2, addressPlate: 0.98, stage: "not_applicable", stageProbabilities: { not_applicable: 0.87 } }),
  ];
  const groups = buildGroups(photos, calls, THRESHOLDS, clocks("07:53", "07:55", "07:55"));
  check("애매한 확인 사진은 자리를 안 가른다", groups.length === 1, groups.map((g) => g.photos.join(",")).join(" / "));
  check("전 사진이 분명하면 다른 장이 위험시설물 0.9 여도 순찰사항", groups[0]?.lane === "waste_cleanup", groups[0]?.lane);

  // 확신이 높은 확인 사진이라도 바로 앞 장이 분명한 「전」이면 그 자리의 후다.
  const sureCheck = calls.map((one) => (one.index === 1 ? { ...one, stageProbabilities: { not_applicable: 0.9 } } : one));
  const still = buildGroups(photos, sureCheck, THRESHOLDS, clocks("07:53", "07:55", "07:55"));
  check("전 사진 바로 뒤의 확인 사진은 그 자리의 후", still.length === 1, still.map((g) => g.photos.join(",")).join(" / "));
}

if (problems.length > 0) {
  console.error(`\n${checked - problems.length}/${checked} 통과 · 실패 ${problems.length}건`);
  for (const problem of problems) console.error(`  → ${problem}`);
  process.exit(1);
}

console.log(`\n${checked}/${checked} 통과`);
