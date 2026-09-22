/**
 * 주소 대조 회귀 검사.
 *
 * **API 도 색인 파일도 필요 없습니다.** 여기서 쓰는 도로명은 전부 지어낸 것입니다.
 * 공개 레포에 실제 지명을 남기지 않으려고 그렇게 했습니다.
 *
 *   npm run check:roads      (노드 22 이상)
 *
 * 고치는 규칙은 `src/core/roads.ts` 한 곳에 있습니다. 그 파일을 고쳤으면 이걸 돌리세요.
 */

import { readAddress } from "../src/core/roads.ts";

/** 지어낸 동 하나. 실제 색인도 이 꼴이다(`npm run roads:build` 가 만든다). */
const INDEX = {
  sigungu: "○○구",
  dong: "○○동",
  builtAt: "2026-09-22",
  source: "검사용(지어낸 값)",
  buildings: {
    "가나로": ["12", "14", "53-4"],
    "가나로1길": ["3", "5", "9-2"],
    "가나로1나길": ["14", "18", "22"],
    "가나로13길": ["16", "27"],
    "다라로": ["7", "9"],
    "다라로2길": ["4"],
  },
};

const problems = [];
let checked = 0;

function check(name, got, want) {
  checked++;
  if (got === want) console.log(`OK   ${name}\n      ${got}`);
  else problems.push(`${name}: 「${want}」 이어야 하는데 「${got}」`);
}

// ── 있는 도로명은 손대지 않는다.
check("있는 도로명은 그대로", readAddress("가나로1나길 14", INDEX).text, "가나로1나길 14");
check("본도로와 부번도 그대로", readAddress("가나로 53-4", INDEX).text, "가나로 53-4");

// ── 한 자 오독은 고친다. 그 동에 그런 도로가 없기 때문이다.
check("한 자 오독을 고친다", readAddress("카나로13길 27", INDEX).text, "가나로13길 27");
check("띄어쓰기가 섞여도 고친다", readAddress("가나로 1나길 18", INDEX).text, "가나로1나길 18");

// ── 두 자가 달라도, 건물번호가 한쪽에만 있으면 그쪽으로 정한다.
//    「가나로나길 22」는 가나로1길과 가나로1나길 사이에서 갈리지만 22번지가 있는 쪽은 하나다.
check("번호가 동점을 깬다", readAddress("가나로나길 22", INDEX).text, "가나로1나길 22");

// ── 갈리면 고르지 않는다. 찍어서 고친 주소는 안 고친 것만 못하다.
{
  const got = readAddress("가나로나길 99", INDEX);
  check("갈리면 고르지 않는다", got.text, "가나로나길 99");
  checked++;
  if (got.correction !== null) problems.push("갈리면 고르지 않는다. 고쳤다고 적혀 있다");
  else console.log("OK   고치지 않았음을 그대로 적는다");
}

// ── 멀면 다른 도로로 본다.
check("멀면 손대지 않는다", readAddress("마바사로9길 3", INDEX).text, "마바사로9길 3");

// ── 시·구가 앞에 붙은 주소판도 있다.
check("시·구 앞머리는 떼고 본다", readAddress("○○특별시 ○○구 가나로13길 16", INDEX).text, "가나로13길 16");

// ── 색인이 없으면 읽은 그대로. 도구는 그대로 돈다.
check("색인이 없으면 그대로", readAddress("카나로13길 27", null).text, "카나로13길 27");

// ── 도로명이 아닌 글자는 주소로 읽지 않는다.
check("간판은 주소가 아니다", readAddress("행복식당 010-0000-0000", INDEX).text, "행복식당 010-0000-0000");
{
  checked++;
  const got = readAddress("행복식당 010-0000-0000", INDEX);
  if (got.road !== null) problems.push("간판은 주소가 아니다. 도로명을 짚었다");
  else console.log("OK   간판에서는 도로명을 짚지 않는다");
}

// ── 번호가 그 도로에 없으면 고치지 않고 표시만 한다.
{
  const got = readAddress("가나로13길 999", INDEX);
  check("없는 번호도 지우지 않는다", got.text, "가나로13길 999");
  checked++;
  if (got.exists !== false) problems.push("없는 번호를 표시하지 않았다");
  else console.log("OK   없는 번호라고 표시한다");
}

// ── 있는 번호는 확인으로 남는다.
{
  checked++;
  const got = readAddress("가나로1길 9-2", INDEX);
  if (got.exists !== true) problems.push("있는 번호를 확인하지 못했다");
  else console.log("OK   있는 번호는 확인으로 남는다");
}

if (problems.length > 0) {
  console.error(`\n${checked - problems.length}/${checked} 통과 · 실패 ${problems.length}건`);
  for (const problem of problems) console.error(`  → ${problem}`);
  process.exit(1);
}

console.log(`\n${checked}/${checked} 통과`);
