import Anthropic from "@anthropic-ai/sdk";
import type { PatrolConfig } from "./config";
import { explainError, explainStatus, keyOrCreditProblem, type Who } from "./why";

/**
 * 사진 → 글의 **눈**. 어느 생성 모델이 사진을 읽을지 고르고, 한 장을 한 번 읽는다.
 *
 * 눈은 둘이다. Claude(`ANTHROPIC_API_KEY`)와 OpenAI 꼴 서버(`OPENAI_API_KEY` · `vision.baseUrl`).
 * 키가 있는 눈만 쓰고, 둘 다 있으면 설정 `vision.first` 가 먼저다(기본 Claude).
 * 먼저인 눈이 **키 · 잔액 문제**(401 · 402 · 403 · 크레딧 소진)로 거절하면 그 자리에서 다음 눈으로 넘어가고,
 * 그 눈은 잠시 쉰다(`BENCH_MS`). 한 장마다 같은 거절을 되풀이하지 않게. 네트워크 · 분당 한도 · 서버 오류는 넘기지 않는다.
 * 그건 눈이 아니라 길의 문제라 다른 눈이라고 다르지 않다.
 *
 * 받는 것은 JSON 글 한 덩이다. 꼴(스키마)은 부르는 쪽이 주고, 두 서버의 요청 꼴로 옮기는 일만 여기서 한다.
 * 지시문은 그대로 보낸다. 판단은 여기서도 시키지 않는다.
 */

export type Eye = "claude" | "openai";

export interface EyeKeys {
  claude?: string;
  openai?: string;
}

/** 부르는 쪽이 주는 JSON 꼴. 이름과 스키마뿐이다. 서버마다 싸는 꼴은 여기서 만든다. */
export interface Shape {
  name: string;
  schema: Record<string, unknown>;
}

export interface EyePhoto {
  /** base64 만. `data:` 접두는 떼고 온다. */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface Glance {
  /** 모델이 돌려준 JSON 글. 꼴을 벗어났을 수 있다. 부르는 쪽이 지킨다. */
  text: string;
  eye: Eye;
  /** 서버가 답한 모델 이름. */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** 키 · 잔액 문제로 거절한 눈을 쉬게 하는 시간. 그 사이에는 다른 눈이 읽는다. */
export const BENCH_MS = 10 * 60_000;
/** 한 장에 기다리는 시간. 연결이 끊기면 한 번만 더 묻는다. */
const TIMEOUT_MS = 60_000;

export const EYE_NAME: Record<Eye, string> = { claude: "Claude", openai: "OpenAI" };
const WHO: Record<Eye, Who> = { claude: "visionClaude", openai: "vision" };

const benched = new Map<Eye, number>();

/** 키가 있는 눈을 설정 차례로. 쉬는 눈은 뒤로 보낸다(전부 쉬면 차례대로 다시 묻는다). */
export function eyeOrder(config: Pick<PatrolConfig, "vision">, keys: EyeKeys, now = Date.now()): Eye[] {
  const order: Eye[] = config.vision.first === "openai" ? ["openai", "claude"] : ["claude", "openai"];
  const ready = order.filter((eye) => Boolean(keys[eye]));
  const awake = ready.filter((eye) => (benched.get(eye) ?? 0) <= now);
  return awake.length > 0 ? [...awake, ...ready.filter((eye) => !awake.includes(eye))] : ready;
}

/** 지금 사진을 읽을 눈. 키가 하나도 없으면 null. 화면의 점과 이름표가 이것을 본다. */
export function whichEye(config: Pick<PatrolConfig, "vision">, keys: EyeKeys): Eye | null {
  return eyeOrder(config, keys)[0] ?? null;
}

/** 검사용. 한 눈을 쉬게 하거나(until) 전부 깨운다. */
export function benchEye(eye?: Eye, until = Date.now() + BENCH_MS): void {
  if (eye) benched.set(eye, until);
  else benched.clear();
}

/** 한 장을 한 번 읽는다. 먼저인 눈이 키 · 잔액 문제면 다음 눈으로. */
export async function glance(photo: EyePhoto, system: string, shape: Shape, config: PatrolConfig, keys: EyeKeys): Promise<Glance> {
  const eyes = eyeOrder(config, keys);
  if (eyes.length === 0) throw new Error("사진을 읽을 키가 없습니다. ANTHROPIC_API_KEY 또는 OPENAI_API_KEY 를 .env.local 에 넣고 다시 띄워 주세요.");

  for (let i = 0; i < eyes.length; i++) {
    const eye = eyes[i];
    try {
      return eye === "claude"
        ? await glanceClaude(photo, system, shape, config, keys.claude ?? "")
        : await glanceOpenAI(photo, system, shape, config, keys.openai ?? "");
    } catch (cause) {
      const last = i === eyes.length - 1;
      if (cause instanceof EyeRefused && !last && keyOrCreditProblem(cause.status, cause.body)) {
        benched.set(eye, Date.now() + BENCH_MS);
        continue;
      }
      throw new Error(cause instanceof EyeRefused ? cause.message : explainError(WHO[eye], cause));
    }
  }
  throw new Error("사진을 읽지 못했습니다.");
}

/** 서버가 답으로 거절한 것(4xx · 5xx). 연결이 끊긴 것과 가른다. */
class EyeRefused extends Error {
  readonly status: number;
  readonly body: string;
  constructor(who: Who, status: number, body: string) {
    super(explainStatus(who, status, body));
    this.name = "EyeRefused";
    this.status = status;
    this.body = body;
  }
}

// ── Claude ─────────────────────────────────────────────

const clients = new Map<string, Anthropic>();

/** 키 · 시간마다 하나. 위험 일지의 둘째 눈도 이것을 쓴다. */
export function anthropicFor(apiKey: string, timeoutMs: number): Anthropic {
  const id = `${timeoutMs}:${apiKey}`;
  let sdk = clients.get(id);
  if (!sdk) {
    // 한 번 시도하고, 끊기면 한 번만 더. 기다리는 사람이 있다.
    sdk = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
    clients.set(id, sdk);
  }
  return sdk;
}

async function glanceClaude(photo: EyePhoto, system: string, shape: Shape, config: PatrolConfig, apiKey: string): Promise<Glance> {
  const sdk = anthropicFor(apiKey, TIMEOUT_MS);
  let response: Anthropic.Message;
  try {
    response = await sdk.messages.create({
      model: config.vision.claude.model,
      max_tokens: config.vision.maxTokens,
      system,
      output_config: { effort: config.vision.claude.effort, format: { type: "json_schema", schema: claudeSchema(shape.schema) as Record<string, unknown> } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.data } },
            { type: "text", text: "Describe this photo." },
          ],
        },
      ],
    });
  } catch (cause) {
    if (cause instanceof Anthropic.APIError && typeof cause.status === "number") throw new EyeRefused("visionClaude", cause.status, cause.message);
    throw cause;
  }
  // 거절(refusal)이면 빈 글. 부르는 쪽이 빈 꼴로 받아 그 장을 비워 둔다. 지어내지 않는다.
  const text = response.stop_reason === "refusal" ? "" : response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  return { text, eye: "claude", model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}

/**
 * OpenAI 꼴 스키마의 `type: ["string", "null"]` 을 Claude 가 받는 `anyOf` 로 옮긴다. 뜻은 같다.
 * 나머지는 그대로다. 두 서버에 스키마를 따로 적어 두면 언젠가 갈라진다.
 */
export function claudeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(claudeSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "type" && Array.isArray(value)) {
      out.anyOf = value.map((type) => ({ type }));
      continue;
    }
    out[key] = claudeSchema(value);
  }
  return out;
}

// ── OpenAI 꼴 ─────────────────────────────────────────

interface Completion {
  choices?: { message?: { content?: string } }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * `/chat/completions` 를 부른다. SDK 를 쓰지 않는 까닭은 받는 것이 JSON 한 덩이라서다. 다른 서버(사내 게이트웨이 · 호환 서버)를
 * 보게 하려면 설정의 `vision.baseUrl` 한 줄만 바꾸면 된다.
 *
 * ⚠️ 실측으로 확인된 함정 둘.
 *   · `max_tokens` 를 거부하는 모델이 있다. 그래서 `max_completion_tokens` 로 보낸다.
 *   · 추론 토큰이 예산을 먼저 먹는다. 사진 한 장에 4096 아래로 주면 빈 응답이 온다.
 */
async function glanceOpenAI(photo: EyePhoto, system: string, shape: Shape, config: PatrolConfig, apiKey: string): Promise<Glance> {
  const response = await fetchTwice(`${config.vision.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: config.vision.model,
      max_completion_tokens: config.vision.maxTokens,
      ...(config.vision.reasoningEffort ? { reasoning_effort: config.vision.reasoningEffort } : {}),
      response_format: { type: "json_schema", json_schema: { name: shape.name, strict: true, schema: shape.schema } },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${photo.mediaType};base64,${photo.data}` } },
            { type: "text", text: "Describe this photo." },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new EyeRefused("vision", response.status, await response.text());
  const body = (await response.json()) as Completion;
  return {
    text: body.choices?.[0]?.message?.content ?? "",
    eye: "openai",
    model: body.model ?? config.vision.model,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
  };
}

/**
 * 연결이 끊겨 던져진 fetch 는 한 번만 다시 부른다(1초 뒤). 순간 끊김이 한 장 때문에 서른 장을 무르지 않게.
 * 응답이 온 것(4xx · 5xx)은 다시 부르지 않는다. 그건 연결이 아니라 서버의 답이다.
 */
async function fetchTwice(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      return await fetch(url, init);
    } catch {
      throw first;
    }
  }
}
