import type { NextConfig } from "next";

/**
 * 이 판을 언제 지었는지. 화면 발치에 적힌다.
 *
 * 폰이 옛 화면 코드를 쥐고 있는지 아닌지를 사람이 바로 알 수 있어야 한다. 고친 것이
 * 사이트에 올라가 있는데도 폰에서 안 보이는 일이 있었고, 그때 어느 쪽 문제인지 아무도
 * 말할 수 없었다. 한국 시각 「월-일 시:분」.
 */
const builtAt = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(5, 16);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILT_AT: builtAt },
};

export default nextConfig;
