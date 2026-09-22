import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Thresholds } from "./lanes";

/**
 * 설정은 레포 뿌리의 `patrol.config.json` 한 장뿐이다.
 * 동 고유값(동 이름·도로명·계절특수 고정 지점)은 전부 여기 있고, 코드에는 없다.
 */
export interface PatrolConfig {
  /** 일지 머리글에 찍히는 동 이름. */
  dong: string;
  /** 담당 부서·반 이름. */
  unit: string;
  /**
   * 그 동에서 자주 나오는 도로명. 주소판 판독의 **참고**일 뿐 화이트리스트가 아니다.
   * 비워 두어도 동작한다. 읽은 대로 쓰는 것이 목록에 억지로 맞추는 것보다 낫다.
   */
  roads: string[];
  /** 그늘막·빗물받이처럼 위치가 고정된 지점. 사진에서 읽지 않고 이 목록을 쓴다. */
  seasonalSpots: string[];
  /**
   * 판정을 어디서 자를지. 숫자를 바꾸려면 실제 사진으로 재 보고 바꾸는 것이 맞다.
   * lane = 묶음을 정한 그 한 장의 확률이 이 아래면 갈래를 안 정하고 사람에게 넘긴다.
   * sameLocation = 이 이상이면 앞 사진과 같은 묶음.
   * addressPlate = 이 이상일 때만 읽은 글자를 주소로 쓴다.
   * sameMinutes = 앞 장과 이 분 안에 찍혔으면 확률을 보지 않고 같은 자리로 잇는다(0 이면 안 씀).
   * splitMinutes = 이 분 넘게 벌어지면 무조건 다른 자리. 주소판보다 세다.
   */
  thresholds: Thresholds;
  vision: {
    /** 사진을 글로 옮기는 생성 모델. */
    model: string;
    /** OpenAI 와 같은 꼴의 주소. 사내 게이트웨이나 호환 서버를 보게 하려면 여기만 바꾼다. */
    baseUrl: string;
    /**
     * 한 장에 허용할 출력 토큰. 추론 토큰이 이 예산을 먼저 먹으므로
     * **4096 아래로 두지 말 것**(실측: 모자라면 빈 응답이 온다).
     */
    maxTokens: number;
    /** 보내기 전에 줄이는 긴 변 픽셀. 작을수록 싸고 빠르다. */
    maxEdge: number;
    concurrency: number;
  };
  firstPass: {
    /** 끄면 1차 판단 없이 전부 「모르겠음」으로 두고 사람이 정한다. */
    enabled: boolean;
    model: string;
    concurrency: number;
  };
  /**
   * 수동 모드. 사진을 모델에 안 보내고 사람이 자리와 말을 적는 길.
   * 모델을 한 번도 안 부르므로 비용이 0 이고, 사진이 이 컴퓨터 밖으로 나가지 않는다.
   */
  manual: {
    /**
     * 시각을 모를 때 몇 장씩 한 자리로 끊을지. 한 자리에서 전·후·주소판 석 장이 보통이다.
     * EXIF 시각이 살아 있는 사진이면 이 값 대신 `thresholds.sameMinutes` 로 묶는다.
     */
    groupSize: number;
  };
  log: {
    /** local = 브라우저에만 쌓는다(아무 데도 안 보냄). off = 아예 안 쌓는다. */
    mode: "local" | "off";
  };
}

export const DEFAULT_CONFIG: PatrolConfig = {
  dong: "○○동",
  unit: "환경순찰",
  roads: [],
  seasonalSpots: [],
  thresholds: { lane: 0.8, sameLocation: 0.5, addressPlate: 0.7, sameMinutes: 2, splitMinutes: 5 },
  vision: {
    model: "gpt-5.6-luna",
    baseUrl: "https://api.openai.com/v1",
    maxTokens: 4096,
    maxEdge: 1024,
    concurrency: 6,
  },
  firstPass: { enabled: true, model: "jev-latest", concurrency: 8 },
  manual: { groupSize: 3 },
  log: { mode: "local" },
};

let cached: PatrolConfig | null = null;

/** 서버에서만 부른다. 읽기 실패하면 기본값으로 돈다. 설정 없이도 켜져야 한다. */
export function loadConfig(): PatrolConfig {
  if (cached) return cached;
  try {
    const raw = readFileSync(join(process.cwd(), "patrol.config.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<PatrolConfig>;
    cached = {
      ...DEFAULT_CONFIG,
      ...parsed,
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...parsed.thresholds },
      vision: { ...DEFAULT_CONFIG.vision, ...parsed.vision },
      firstPass: { ...DEFAULT_CONFIG.firstPass, ...parsed.firstPass },
      manual: { ...DEFAULT_CONFIG.manual, ...parsed.manual },
      log: { ...DEFAULT_CONFIG.log, ...parsed.log },
    };
  } catch {
    cached = DEFAULT_CONFIG;
  }
  return cached;
}

/**
 * 키 읽기.
 *
 * 쓰라고 적어 둔 이름은 `OPENAI_API_KEY` · `TYPESAFE_API_KEY` 둘뿐이다(README 도 그렇게 적혀 있다).
 *
 * 다만 한 기계에서 여러 일을 하는 사람은 이미 그 이름을 다른 일에 쓰고 있다. 모르고 그 키로
 * 돌면 비용이 섞여서 「이 도구가 얼마 썼나」를 나중에 못 가린다. 그래서 **이 레포 이름이 붙은
 * 쪽을 먼저 본다.** 그런 게 없으면 그때 원래 이름을 쓴다. 새로 받은 사람에게는 이름 하나뿐이다.
 */
export function readKey(base: "OPENAI_API_KEY" | "TYPESAFE_API_KEY"): string | undefined {
  // OPEN_AI 는 이 도구보다 먼저 그 이름으로 키를 넣어 둔 기계를 위한 자리다.
  const legacy = base === "OPENAI_API_KEY" ? ["OPEN_AI"] : [];
  const names = [`${base}_PATROL_JEV`, `${base}_patrol-jev`, base, ...legacy];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** 브라우저로 내려보내는 몫. 키나 경로는 절대 담지 않는다. */
export type ClientConfig = Pick<
  PatrolConfig,
  "dong" | "unit" | "seasonalSpots" | "thresholds" | "vision" | "firstPass" | "manual" | "log"
>;

export function toClientConfig(c: PatrolConfig): ClientConfig {
  return {
    dong: c.dong,
    unit: c.unit,
    seasonalSpots: c.seasonalSpots,
    thresholds: c.thresholds,
    vision: c.vision,
    firstPass: c.firstPass,
    manual: c.manual,
    log: c.log,
  };
}
