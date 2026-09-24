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
