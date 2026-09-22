import type { PatrolConfig } from "./config";
import { visionSystemFor } from "./judgment";
import { mapWithConcurrency } from "./jev";
import { commonRoads, readAddress, type RoadIndex } from "./roads";
import type { Described } from "./types";

/**
 * 사진 → 글. 파이프라인에서 **유일하게 생성 모델을 쓰는 자리**다.
 *
 * Jev 는 이미지를 못 받으므로(텍스트·JSON 만) 한 번은 눈이 필요하다.
 * 대신 이 모델에게 판단은 시키지 않는다. 본 것과 읽은 글자만 받는다.
 * 분류는 Jev 가, 문장은 코드가 만든다.
 *
 * OpenAI 와 같은 꼴의 `/chat/completions` 를 부른다. SDK 를 쓰지 않는 까닭은 부르는 자리가
 * 여기 한 곳뿐이고 받는 것도 JSON 한 덩이라서다. 다른 서버(사내 게이트웨이·호환 서버)를
 * 보게 하려면 설정의 `vision.baseUrl` 한 줄만 바꾸면 된다.
 *
 * ⚠️ 실측으로 확인된 함정 둘.
 *   · `max_tokens` 를 거부하는 모델이 있다. 그래서 `max_completion_tokens` 로 보낸다.
 *   · 추론 토큰이 예산을 먼저 먹는다. 사진 한 장에 4096 아래로 주면 빈 응답이 온다.
 */

export interface PhotoInput {
  index: number;
  /** base64 만. `data:` 접두는 떼고 온다. */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

/** 받을 JSON 의 꼴. 형식을 모델에게 맡기지 않고 요청에 같이 싣는다. */
const SHAPE = {
  type: "json_schema",
  json_schema: {
    name: "photo_facts",
    strict: true,
    schema: {
      type: "object",
      properties: {
        caption: { type: "string" },
        caption_ko: { type: "string" },
        text_in_photo: { type: ["string", "null"] },
        sign_text: { type: ["string", "null"] },
      },
      required: ["caption", "caption_ko", "text_in_photo", "sign_text"],
      additionalProperties: false,
    },
  },
} as const;

interface Completion {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function describePhotos(
  photos: PhotoInput[],
  config: PatrolConfig,
  apiKey?: string,
  /** 담당자가 고른 동의 도로명 색인. 없으면 읽은 글자를 그대로 쓴다. */
  roadIndex?: RoadIndex | null,
): Promise<Described[]> {
  // 설정에 적어 둔 도로명이 있으면 그것을, 없으면 고른 동의 색인에서 가져와 읽기 참고로 준다.
  const hint = config.roads.length > 0 ? config.roads : commonRoads(roadIndex ?? null);
  const system = visionSystemFor(hint);

  return mapWithConcurrency(photos, config.vision.concurrency, async (photo) => {
    const started = Date.now();
    const response = await fetch(`${config.vision.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey ?? ""}` },
      body: JSON.stringify({
        model: config.vision.model,
        max_completion_tokens: config.vision.maxTokens,
        response_format: SHAPE,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${photo.mediaType};base64,${photo.data}` },
              },
              { type: "text", text: "Describe this photo." },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`사진을 읽지 못했습니다 (${response.status}) ${short(await response.text())}`);
    }

    const body = (await response.json()) as Completion;
    const ms = Date.now() - started;
    const parsed = parseShape(body.choices?.[0]?.message?.content ?? "");

    // 읽은 주소를 그 동의 실제 도로명과 맞춰 본다. 모델에게 다시 묻지 않는다.
    const address = parsed.sign_text ? readAddress(parsed.sign_text, roadIndex ?? null) : null;

    return {
      index: photo.index,
      caption: parsed.caption,
      // 한국어를 못 받았으면 영어라도 보인다. 빈 줄보다는 낫다.
      captionKo: parsed.caption_ko || parsed.caption,
      textInPhoto: parsed.text_in_photo,
      signText: address ? address.text : null,
      signRaw: address?.correction ? address.correction.from : null,
      signExists: address ? address.exists : null,
      ms,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  });
}

/** 오류 본문은 길다. 화면에 띄울 만큼만 남긴다. */
function short(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 200);
}

/** 형식은 서버가 보장하지만, 빈 응답·잘린 응답에도 파이프라인이 멈추면 안 된다. */
function parseShape(text: string): {
  caption: string;
  caption_ko: string;
  text_in_photo: string | null;
  sign_text: string | null;
} {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return {
      caption: typeof value.caption === "string" ? value.caption : "",
      caption_ko: typeof value.caption_ko === "string" ? value.caption_ko : "",
      text_in_photo: typeof value.text_in_photo === "string" ? value.text_in_photo : null,
      sign_text: typeof value.sign_text === "string" ? value.sign_text : null,
    };
  } catch {
    return { caption: "", caption_ko: "", text_in_photo: null, sign_text: null };
  }
}
