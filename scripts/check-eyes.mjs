/**
 * 사진 읽는 눈 고르기 회귀 검사.
 *
 * **API 를 부르지 않습니다.** 키 유무와 설정으로 어느 눈이 먼저인지, 키 · 잔액 문제일 때만 다른 눈으로 넘기는지,
 * 쉬는 눈이 뒤로 가는지, OpenAI 꼴 스키마가 Claude 꼴로 그대로 옮겨지는지를 봅니다.
 *
 *   npm run check:eyes      (노드 22 이상)
 */

import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { BENCH_MS, benchEye, claudeSchema, eyeOrder, whichEye } from "../src/core/eyes.ts";
import { keyOrCreditProblem } from "../src/core/why.ts";

const problems = [];
let checked = 0;
function check(name, condition, detail = "") {
  checked++;
  if (condition) console.log(`OK   ${name}`);
  else problems.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const withFirst = (first) => ({ vision: { ...DEFAULT_CONFIG.vision, first } });
const both = { claude: "a", openai: "b" };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── ① 차례
check("기본은 Claude 먼저", DEFAULT_CONFIG.vision.first === "claude");
check("둘 다 있으면 설정 차례(claude)", same(eyeOrder(withFirst("claude"), both), ["claude", "openai"]));
check("둘 다 있으면 설정 차례(openai)", same(eyeOrder(withFirst("openai"), both), ["openai", "claude"]));
check("Claude 키만 있으면 Claude", same(eyeOrder(withFirst("openai"), { claude: "a" }), ["claude"]));
check("OpenAI 키만 있으면 OpenAI", same(eyeOrder(withFirst("claude"), { openai: "b" }), ["openai"]));
check("키가 없으면 빈 차례", eyeOrder(withFirst("claude"), {}).length === 0);
check("빈 문자열 키는 없는 키", eyeOrder(withFirst("claude"), { claude: "", openai: "b" }).length === 1);
check("whichEye = 첫째", whichEye(withFirst("claude"), both) === "claude");
check("whichEye 키 없음 = null", whichEye(withFirst("claude"), {}) === null);

// ── ② 쉬는 눈
benchEye("claude");
check("쉬는 눈은 뒤로", same(eyeOrder(withFirst("claude"), both), ["openai", "claude"]));
check("쉬는 동안 whichEye 도 바뀜", whichEye(withFirst("claude"), both) === "openai");
check("쉬는 눈만 있으면 그래도 묻는다", same(eyeOrder(withFirst("claude"), { claude: "a" }), ["claude"]));
check("시간이 지나면 돌아온다", same(eyeOrder(withFirst("claude"), both, Date.now() + BENCH_MS + 1), ["claude", "openai"]));
benchEye();
check("깨우면 제자리", same(eyeOrder(withFirst("claude"), both), ["claude", "openai"]));
check("쉬는 시간은 10분", BENCH_MS === 10 * 60_000);

// ── ③ 넘길 때 · 안 넘길 때
check("401 은 넘긴다", keyOrCreditProblem(401));
check("402 는 넘긴다", keyOrCreditProblem(402));
check("403 은 넘긴다", keyOrCreditProblem(403));
check("Claude 크레딧 소진(400 본문)은 넘긴다", keyOrCreditProblem(400, "Your credit balance is too low to access the Anthropic API."));
check("OpenAI 잔액(429 본문)은 넘긴다", keyOrCreditProblem(429, '{"error":{"code":"insufficient_quota"}}'));
check("분당 한도(429 맨몸)는 안 넘긴다", !keyOrCreditProblem(429, '{"error":{"code":"rate_limit_exceeded"}}'));
check("400 옵션 오류는 안 넘긴다", !keyOrCreditProblem(400, "Unsupported parameter"));
check("404 모델 이름은 안 넘긴다", !keyOrCreditProblem(404, "model not found"));
check("500 은 안 넘긴다", !keyOrCreditProblem(500));
check("529 는 안 넘긴다", !keyOrCreditProblem(529, "overloaded"));

// ── ④ 스키마 옮기기
{
  const shape = {
    type: "object",
    properties: {
      caption: { type: "string" },
      text_in_photo: { type: ["string", "null"] },
      items: { type: "array", items: { type: "object", properties: { count: { type: ["integer", "null"] } }, required: ["count"], additionalProperties: false } },
    },
    required: ["caption", "text_in_photo", "items"],
    additionalProperties: false,
  };
  const out = claudeSchema(shape);
  check("보통 type 은 그대로", out.properties.caption.type === "string");
  check("배열 type 은 anyOf 로", same(out.properties.text_in_photo, { anyOf: [{ type: "string" }, { type: "null" }] }));
  check("깊은 곳도 옮긴다", same(out.properties.items.items.properties.count, { anyOf: [{ type: "integer" }, { type: "null" }] }));
  check("required 배열은 그대로", same(out.required, shape.required));
  check("additionalProperties false 유지", out.additionalProperties === false && out.properties.items.items.additionalProperties === false);
  check("원본은 안 건드린다", Array.isArray(shape.properties.text_in_photo.type));
}

console.log(`\n${checked - problems.length}/${checked}`);
if (problems.length > 0) {
  console.log("\nFAIL");
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}
