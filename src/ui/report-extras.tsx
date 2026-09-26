"use client";

import type { IljiSlots } from "@/core/ilji-slots";

/**
 * 보고서 탭 아래 붙는 자리. 이 레포에는 비어 있다.
 * 사이트에는 부서 양식 채우기가 여기 붙는다. 화면 코드(app.tsx)는 같고 다른 것은 이 파일 하나다.
 */
export function ReportExtras(props: { collect: (ratio: number) => Promise<IljiSlots>; date: string }) {
  void props;
  return null;
}

/**
 * 주간 일지를 다른 양식으로 채우는 자리. 이 레포에는 없어서 null 이고, 주간 일지는 기본 양식으로 나간다.
 */
export function weeklyFormOf(): { name: string; photoRatio: number; build: (days: IljiSlots[]) => { bytes: Uint8Array; note: string } } | null {
  return null;
}
