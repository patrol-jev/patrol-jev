import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { PatrolConfig } from "./config";
import { BASE_QUESTIONS, SAME_LOCATION_QUESTION, type PhotoState } from "./judgment";
import { LANE_ORDER, type Lane } from "./lanes";
import type { FirstPass, FirstPassInput, Judged } from "./types";

/**
 * Jev 1차 판단기.
 *
 * 한 장에 한 번 부르고, 그 한 번에 네 질문을 같이 싣는다(서로 독립이라 병렬로 답이 온다).
 * 여러 장은 동시에 부른다 — 배치 호출은 API 에 없고, 대신 분당 요청 한도가 넉넉하다.
 */
export class JevFirstPass implements FirstPass {
  readonly name: string;
  #client: TypeSafeClient;
  #config: PatrolConfig;

  constructor(config: PatrolConfig, apiKey?: string) {
    this.#config = config;
    this.#client = new TypeSafeClient({
      apiKey,
      defaultModel: config.firstPass.model,
      // 판정 한 건은 짧다. 오래 매달려 있는 것보다 빨리 실패하고 재시도하는 편이 낫다.
      timeout: 15_000,
    });
    this.name = config.firstPass.model;
  }

  async decide(items: FirstPassInput[]): Promise<Judged[]> {
    return mapWithConcurrency(items, this.#config.firstPass.concurrency, (item) =>
      this.#decideOne(item),
    );
  }

  async #decideOne(item: FirstPassInput): Promise<Judged> {
    const state: PhotoState = {
      photo: {
        index: item.index,
        caption: item.caption,
        text_in_photo: item.textInPhoto,
        sign_text: item.signText,
      },
      previous_photo: item.previous
        ? {
            index: item.previous.index,
            caption: item.previous.caption,
            minutes_before: item.previous.minutesApart,
          }
        : null,
    };

    // 앞 장이 없으면 「같은 자리인가」는 아예 묻지 않는다. 그래서 호출이 두 갈래다.
    const started = Date.now();
    const result = item.previous
      ? await this.#client.systemOne({
          state,
          questions: { ...BASE_QUESTIONS, same_location: SAME_LOCATION_QUESTION },
        })
      : await this.#client.systemOne({ state, questions: BASE_QUESTIONS });
    const ms = Date.now() - started;

    // 질문이 두 갈래라 답의 타입도 두 갈래다. 우리 쪽 모양으로 여기서 한 번만 맞춘다.
    const answers = result.answers as {
      lane: { choice: string; confidence: number; probabilities: Record<string, number> };
      address_plate: { noul: number };
      stage: {
        choice: "before" | "after" | "not_applicable";
        probabilities: Record<string, number>;
      };
      same_location?: { noul: number };
    };
    const { lane, stage, address_plate: plate, same_location: same } = answers;

    const probabilities = normaliseLanes(lane.probabilities);
    const top = probabilities[lane.choice as Lane] ?? 0;

    return {
      index: item.index,
      // 문턱 아래거나 아무 갈래도 아니면 사람에게 넘긴다. 이 자리를 비워 두는 것이 이 도구의 핵심이다.
      lane:
        top < this.#config.thresholds.lane || lane.choice === "none_of_these"
          ? "unknown"
          : (lane.choice as Lane),
      laneProbabilities: probabilities,
      laneConfidence: lane.confidence,
      stage: stage.choice,
      stageProbabilities: stage.probabilities,
      // 글자를 아예 못 읽었으면 물어볼 것도 없다.
      addressPlate: item.signText ? plate.noul : null,
      sameLocation: same ? same.noul : null,
      ms,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      model: result.model,
    };
  }
}

/** 1차 판단을 끈 경우. 전부 「모르겠음」으로 두고 사람이 정한다 — 앱은 그대로 돈다. */
export class NoFirstPass implements FirstPass {
  readonly name = "off";

  async decide(items: FirstPassInput[]): Promise<Judged[]> {
    return items.map((item) => ({
      index: item.index,
      lane: "unknown" as const,
      laneProbabilities: { waste_cleanup: 0, flood_season: 0, risk_facility: 0, none_of_these: 0 },
      laneConfidence: 0,
      stage: "not_applicable" as const,
      stageProbabilities: {},
      addressPlate: null,
      sameLocation: null,
      ms: 0,
      inputTokens: 0,
      outputTokens: 0,
      model: "off",
    }));
  }
}

function normaliseLanes(raw: Record<string, number>): Record<Lane, number> {
  const out = {} as Record<Lane, number>;
  for (const lane of LANE_ORDER) out[lane] = raw[lane] ?? 0;
  return out;
}

/** 동시 호출 수를 눌러 둔다. 분당 한도를 넘기면 재시도로 오히려 느려진다. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
