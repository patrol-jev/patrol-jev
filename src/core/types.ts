import type { Lane, LaneOrUnknown } from "./lanes";

/** 생성 모델이 사진 한 장을 글로 옮긴 결과. */
export interface Described {
  index: number;
  /** 판정에 넘기는 영어 한 줄. Jev 는 영어에서 가장 정확하다. */
  caption: string;
  /** 화면에 보이는 한국어 한 줄. 사람이 읽을 것은 우리말이어야 한다. */
  captionKo: string;
  textInPhoto: string | null;
  /** 주소판 글자. 동을 골랐으면 그 동의 도로명으로 **대조·교정된** 값이다. */
  signText: string | null;
  /** 고치기 전, 모델이 읽은 그대로. 안 고쳤으면 null — 화면에서 무엇을 고쳤는지 보이려고 둔다. */
  signRaw: string | null;
  /**
   * 그 도로에 그 건물번호가 실제로 있는가. null = 대조할 수 없었다
   * (색인 없음 · 도로명을 못 짚음 · 번호를 못 읽음).
   */
  signExists: boolean | null;
  ms: number;
  inputTokens: number;
  outputTokens: number;
}

/** Jev 가 한 장에 내린 판정. 고른 값만이 아니라 **분포 전체**를 들고 다닌다. */
export interface Judged {
  index: number;

  /** 문턱 아래면 "unknown". 억지로 정하지 않는다. */
  lane: LaneOrUnknown;
  /** 고른 갈래의 확률이 아니라 네 갈래 전부의 확률. 화면에 그대로 보인다. */
  laneProbabilities: Record<Lane, number>;
  laneConfidence: number;

  stage: "before" | "after" | "not_applicable";
  stageProbabilities: Record<string, number>;

  /** 읽은 글자가 주소판일 확률. 글자가 없었으면 null. */
  addressPlate: number | null;
  /** 앞 장과 같은 자리일 확률. 첫 장이면 null. */
  sameLocation: number | null;

  ms: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * 1차 판단기 — 무엇을 쓰든 이 자리만 지키면 갈아끼울 수 있다.
 *
 * ⚠ Jev 는 **이미지를 받지 않는다**(텍스트·JSON 만). 확인한 사실이다.
 * 그래서 사진은 먼저 생성 모델이 글로 옮기고, 이 자리에는 그 글이 들어온다.
 * 모델이 바뀌어도 이 인터페이스는 안 바뀐다.
 */
export interface FirstPassInput {
  index: number;
  caption: string;
  textInPhoto: string | null;
  signText: string | null;
  previous: {
    index: number;
    caption: string;
    /**
     * 앞 장과 몇 분 차이인가. 두 장 다 시각을 알 때만 채운다(EXIF 이거나 사진에 찍힌 워터마크).
     * 모르면 null — 0 으로 채우면 「바로 다음 장」이라고 잘못 말하는 것이 된다.
     */
    minutesApart: number | null;
  } | null;
}

export interface FirstPass {
  /** 화면에 그대로 찍힌다. 무엇이 판단했는지 숨기지 않는다. */
  readonly name: string;
  decide(items: FirstPassInput[]): Promise<Judged[]>;
}

/** 사람이 고친 것까지 반영된, 한 자리에 모인 사진 묶음. */
export interface Group {
  id: string;
  /** 사진 index 목록, 찍힌 차례대로. */
  photos: number[];
  /** 주소판에서 읽은 주소. 없으면 빈 문자열 — **지어내지 않는다**. */
  address: string;
  lane: LaneOrUnknown;
  /** 사람이 손댄 묶음인가. 로그의 「고친 횟수」가 여기서 나온다. */
  edited: boolean;
  /** 지난번에 사람이 정해 준 갈래를 그대로 얹은 자리인가. 화면에 그렇다고 적는다. */
  learned?: boolean;
  /**
   * 이 자리에 대해 일지에 적을 말. 안 정했으면 란의 기본 문구를 쓴다.
   * 한 자리만 다른 일을 한 날이 있다(경고스티커 부착처럼). 그럴 때 여기만 바꾼다.
   */
  work?: string;
  /** 찍힌 시각 중 가장 이른 것 (HH:MM). 없으면 빈 문자열. */
  time: string;
}

/** 익명 사용 로그 한 줄. 사진도, 주소도, 사람도 담기지 않는다. */
export interface UsageRecord {
  at: string;
  /**
   * 어느 길로 만들었나. auto = 모델이 사진을 읽었다 · manual = 사람이 적었다.
   * 이 칸이 생기기 전 기록에는 없다(undefined). 「몇 %가 수동으로 쓰나」를 나중에 말하려고 둔다.
   */
  mode?: "auto" | "manual";
  photos: number;
  groups: number;
  visionMs: number;
  visionCalls: number;
  visionInputTokens: number;
  visionOutputTokens: number;
  firstPassMs: number;
  firstPassCalls: number;
  firstPassInputTokens: number;
  unknownLanes: number;
  manualEdits: number;
  copied: boolean;
  /** 첫 실행 때 한 번 묻는 「전에는 한 장 쓰는 데 얼마나 걸렸나」(분). 안 답하면 null. */
  baselineMinutes: number | null;
}
