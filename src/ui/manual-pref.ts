"use client";

/**
 * 「수동」으로 쓰기.
 *
 * 켜 두면 사진을 모델로 보내지 않는다. 묶기·시각·일지 문장은 그대로 나오고, 자리와 말만 사람이 적는다.
 * 사진을 밖으로 내보내면 안 되는 자리에서 쓰는 길이라, 한 번 켜면 이 브라우저가 기억한다.
 * 다음에 열었을 때 저절로 모델 쪽으로 돌아가 있으면 안 된다.
 */

const MANUAL = "patrol-jev.manual";

export function readManual(): boolean {
  try {
    return localStorage.getItem(MANUAL) === "1";
  } catch {
    return false;
  }
}

export function saveManual(on: boolean): void {
  try {
    if (on) localStorage.setItem(MANUAL, "1");
    else localStorage.removeItem(MANUAL);
  } catch {
    // 기억하지 못해도 이번 화면에서는 고른 대로 돈다.
  }
}
