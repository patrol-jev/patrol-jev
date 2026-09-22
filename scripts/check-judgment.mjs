/**
 * 판정 회귀 검사.
 *
 * `src/core/judgment.ts` 의 질문을 고쳤으면 이걸 돌리세요. 사진 없이 **글만** 넣어
 * 갈래가 제자리로 가는지 봅니다. 실제 사진은 여기 들어가지 않습니다 — 지명도 없습니다.
 *
 *   npm run dev
 *   node scripts/check-judgment.mjs
 *
 * 이 검사는 진짜 API 를 부릅니다. 판정은 입력만 과금이고 출력은 무료입니다
 * (단가는 https://docs.typesafe.ai/models).
 */

const BASE = process.env.PATROL_JEV_URL ?? "http://localhost:3000";

/** 문턱은 patrol.config.json 기본값과 같게 둔다. 설정을 바꿨으면 여기도 같이 보세요. */
const THRESHOLD = { lane: 0.55, addressPlate: 0.7 };

const CASES = [
  {
    name: "골목 폐기물 — 치우기 전",
    caption:
      "A narrow alley between low buildings. Several bags of household refuse and loose litter are piled against a wall. A dustpan and broom lean beside them.",
    signText: null,
    lane: "waste_cleanup",
  },
  {
    name: "골목 폐기물 — 치운 뒤",
    caption:
      "The same narrow alley, now empty and swept. The road surface is clear and no refuse remains against the wall.",
    signText: null,
    lane: "waste_cleanup",
  },
  {
    name: "도로변 투기물",
    caption:
      "A roadside kerb with a broken chair and two tied plastic sacks left on the pavement, partly blocking the footway.",
    signText: null,
    lane: "waste_cleanup",
  },
  {
    name: "빗물받이",
    caption:
      "A metal storm drain grate set into the edge of a road. Fallen leaves and grit cover about half of the openings.",
    signText: null,
    lane: "flood_season",
  },
  {
    name: "그늘막",
    caption:
      "A fabric sunshade canopy on a steel frame standing beside a pedestrian crossing, open over the waiting area.",
    signText: null,
    lane: "flood_season",
  },
  {
    name: "옹벽 균열",
    caption:
      "A concrete retaining wall beside a slope. A long vertical crack runs down it and some of the surface has flaked away.",
    signText: null,
    lane: "risk_facility",
  },
  {
    name: "도로 파손",
    caption:
      "A section of asphalt road surface that has sunk and cracked into pieces, with loose fragments around the hollow.",
    signText: null,
    lane: "risk_facility",
  },
  {
    name: "주소판만 찍힌 장 — 갈래는 비워야 한다",
    caption:
      "A close view of a blue pentagonal street sign fixed to a wall, printed with a road name above and a building number below.",
    signText: "○○로12길 34",
    lane: "unknown",
    addressPlate: "above",
  },
  {
    name: "간판을 주소로 읽은 경우 — 걸러내야 한다",
    caption:
      "A close view of a red and white shop signboard above a doorway, with a business name and a phone number.",
    signText: "행복식당 010-0000-0000",
    addressPlate: "below",
  },
  {
    name: "읽을 수 없는 장",
    caption: "A very dark, heavily blurred photograph. Nothing in the frame can be made out.",
    signText: null,
    lane: "unknown",
  },
];

const results = [];

for (const [i, testCase] of CASES.entries()) {
  const response = await fetch(`${BASE}/api/judge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          index: i,
          caption: testCase.caption,
          textInPhoto: testCase.signText,
          signText: testCase.signText,
          previous: null,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`요청 실패 (${response.status}) — ${body}`);
    console.error("개발 서버가 떠 있고 TYPESAFE_API_KEY 가 잡혀 있는지 보세요.");
    process.exit(1);
  }

  const { judged, firstPass } = await response.json();
  const one = judged[0];

  if (firstPass === "off") {
    console.error("1차 판단이 꺼져 있습니다. TYPESAFE_API_KEY 가 없으면 이 검사는 뜻이 없습니다.");
    process.exit(1);
  }

  const problems = [];
  if (testCase.lane && one.lane !== testCase.lane) {
    problems.push(`갈래 ${testCase.lane} 이어야 하는데 ${one.lane}`);
  }
  if (testCase.addressPlate === "above" && !(one.addressPlate >= THRESHOLD.addressPlate)) {
    problems.push(`주소판 ${THRESHOLD.addressPlate} 이상이어야 하는데 ${fmt(one.addressPlate)}`);
  }
  if (testCase.addressPlate === "below" && !(one.addressPlate < THRESHOLD.addressPlate)) {
    problems.push(`주소판 ${THRESHOLD.addressPlate} 미만이어야 하는데 ${fmt(one.addressPlate)}`);
  }

  results.push({ testCase, one, problems });

  const top = Object.entries(one.laneProbabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([lane, p]) => `${lane} ${p.toFixed(2)}`)
    .join("  ");

  console.log(
    `${problems.length === 0 ? "OK  " : "실패"} ${testCase.name}\n` +
      `      ${one.lane}  ·  ${one.ms}ms  ·  주소판 ${fmt(one.addressPlate)}\n` +
      `      ${top}` +
      (problems.length > 0 ? `\n      → ${problems.join(" / ")}` : ""),
  );
}

const failed = results.filter((r) => r.problems.length > 0);
const ms = results.map((r) => r.one.ms).sort((a, b) => a - b);
const tokens = results.reduce((sum, r) => sum + r.one.inputTokens, 0);

console.log(
  `\n${results.length - failed.length}/${results.length} 통과  ·  ` +
    `판정 중앙값 ${ms[Math.floor(ms.length / 2)]}ms  ·  ` +
    `입력 ${tokens.toLocaleString()} tok  ·  출력 무료`,
);

if (failed.length > 0) process.exit(1);

function fmt(value) {
  return value === null ? "묻지 않음" : value.toFixed(2);
}
