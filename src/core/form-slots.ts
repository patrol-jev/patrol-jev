import type { IljiRows } from "./ilji-slots";

/**
 * 부서 양식에 채우는 **자리 이름**. 브라우저 화면과 서버 지도가 같이 쓴다.
 * 이 파일은 아무것도 import 하지 않는다(브라우저에도 들어간다).
 */
export type SlotKey = "dateLabel" | "officer" | "area" | keyof IljiRows;

export const SLOT_LABELS: Record<SlotKey, string> = {
  dateLabel: "순찰일시",
  officer: "순찰자",
  area: "순찰지역",
  seasonal: "계절특수",
  facility: "위험시설물",
  community: "주민소통",
  patrol: "순찰사항",
  etc: "특이사항",
};
