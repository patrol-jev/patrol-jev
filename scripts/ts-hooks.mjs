/**
 * 검사 스크립트가 `src/core` 의 TypeScript 를 **그대로** 읽게 해 주는 조각.
 *
 * 노드는 `./lanes` 처럼 확장자 없는 경로를 못 찾는다. 여기서 `.ts` 를 붙여 준다.
 * 그래서 검사 스크립트는 빌드도, 번들러도, 따로 깐 도구도 없이 돈다 — 그리고 검사가
 * **앱과 똑같은 코드**를 부른다. 검사용으로 베껴 둔 사본은 언젠가 반드시 갈라진다.
 *
 *   node --experimental-strip-types --import ./scripts/ts-hooks.mjs scripts/check-report.mjs
 *
 * 앱이 도는 데에는 쓰이지 않는다. 검사 때만 끼어든다.
 */

import { register } from "node:module";

// --import 로 먼저 불렸을 때 스스로를 해석 훅으로 등록한다. 훅 쪽에서 또 등록하지 않도록 막는다.
if (!process.env.PATROL_TS_HOOKS) {
  process.env.PATROL_TS_HOOKS = "1";
  register(import.meta.url);
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    try {
      return await next(specifier, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return next(`${specifier}.ts`, context);
    }
  }
  return next(specifier, context);
}
