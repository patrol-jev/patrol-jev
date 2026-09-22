/**
 * 갈래. 순찰일지의 란이 곧 갈래다. 여기 없는 판단은 하지 않는다.
 *
 * 위험성 등급·폐기물 종류·평가항목·배점은 **일부러 없다.**
 * 그런 판단은 담당자가 한다. 도구가 늘어나면 쓰는 사람이 준다.
 *
 * 이 파일은 브라우저에도 들어간다. 그래서 아무것도 import 하지 않는다.
 */

export const LANES = {
  waste_cleanup: "순찰사항",
  flood_season: "계절특수(풍수해)",
  risk_facility: "위험시설물",
  none_of_these: "모르겠음",
} as const;

export type Lane = keyof typeof LANES;

/** 확률이 문턱 아래일 때 붙는 자리. 억지로 정하지 않는다. */
export type LaneOrUnknown = Lane | "unknown";

export const LANE_ORDER: Lane[] = [
  "waste_cleanup",
  "flood_season",
  "risk_facility",
  "none_of_these",
];

/**
 * 「아무것도 아님」을 뺀 실질 갈래.
 *
 * 묶음의 갈래를 정할 때 이 셋끼리만 견준다. 한 자리에서 찍은 석 장 가운데 청소 뒤 사진과
 * 주소판 사진은 「아무것도 아님」이 1.00 으로 나오는 것이 맞다. 그 답까지 경쟁에 넣으면
 * 어느 자리든 「아무것도 아님」이 이겨 버린다.
 */
export const REAL_LANES: Lane[] = ["waste_cleanup", "flood_season", "risk_facility"];

/** 사람이 고를 수 있는 것. 「모르겠음」도 고를 수 있어야 한다. */
export const HUMAN_CHOICES: LaneOrUnknown[] = [
  "waste_cleanup",
  "flood_season",
  "risk_facility",
  "unknown",
];

export function laneLabel(lane: LaneOrUnknown): string {
  return lane === "unknown" ? "모르겠음" : LANES[lane];
}

/** 판정에 쓰는 문턱값만. 설정 전체를 브라우저로 내리지 않으려고 따로 둔다. */
export interface Thresholds {
  lane: number;
  sameLocation: number;
  addressPlate: number;
  /**
   * 앞 장과 몇 분 안이면 확률을 보지 않고 같은 자리로 잇는가.
   * 0 으로 두면 시각을 안 쓰고 확률만 본다.
   */
  sameMinutes: number;
  /**
   * 앞 장과 몇 분 넘게 벌어지면 **무조건** 다른 자리로 보는가.
   * 주소판보다 세다. 같은 주소판 앞에서 찍혔어도 두 시간 벌어졌으면 거기서 한 일이 아니다.
   */
  splitMinutes: number;
}
