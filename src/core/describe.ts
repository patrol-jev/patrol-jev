import type { PatrolConfig } from "./config";
import { glance, type EyeKeys, type Shape } from "./eyes";
import { visionSystemFor } from "./judgment";
import { mapWithConcurrency } from "./jev";
import { commonRoads, readAddress, readAddressInText, type RoadIndex } from "./roads";
import type { Described } from "./types";

/**
 * 사진 → 글. 파이프라인에서 **유일하게 생성 모델을 쓰는 자리**다.
 *
 * Jev 는 이미지를 못 받으므로(텍스트·JSON 만) 한 번은 눈이 필요하다.
 * 대신 이 모델에게 판단은 시키지 않는다. 본 것과 읽은 글자만 받는다.
 * 분류는 Jev 가, 문장은 코드가 만든다.
 *
 * 어느 모델이 읽나(Claude · OpenAI 꼴)는 `eyes.ts` 가 키와 설정으로 고른다. 여기는 꼴과 뒷처리만 안다.
 */

export interface PhotoInput {
  index: number;
  /** base64 만. `data:` 접두는 떼고 온다. */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

/** 받을 JSON 의 꼴. 형식을 모델에게 맡기지 않고 요청에 같이 싣는다. */
const SHAPE: Shape = {
  name: "photo_facts",
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
};

export async function describePhotos(
  photos: PhotoInput[],
  config: PatrolConfig,
  keys: EyeKeys,
  /** 담당자가 고른 동의 도로명 색인. 없으면 읽은 글자를 그대로 쓴다. */
  roadIndex?: RoadIndex | null,
): Promise<Described[]> {
  // 설정에 적어 둔 도로명이 있으면 그것을, 없으면 고른 동의 색인에서 가져와 읽기 참고로 준다.
  const hint = config.roads.length > 0 ? config.roads : commonRoads(roadIndex ?? null);
  const system = visionSystemFor(hint);

  return mapWithConcurrency(photos, config.vision.concurrency, async (photo) => {
    const started = Date.now();
    const seen = await glance(photo, system, SHAPE, config, keys);
    const ms = Date.now() - started;
    const parsed = parseShape(seen.text);

    // 읽은 주소를 그 동의 실제 도로명과 맞춰 본다. 모델에게 다시 묻지 않는다.
    // 주소판 글자를 비워 왔으면 옮겨 적은 글에서 주소판 꼴(도로명 줄 + 번호 줄)을 색인과 대조해 찾는다.
    const address = parsed.sign_text
      ? readAddress(parsed.sign_text, roadIndex ?? null)
      : readAddressInText(parsed.text_in_photo, roadIndex ?? null);

    return {
      index: photo.index,
      caption: parsed.caption,
      // 한국어를 못 받았으면 영어라도 보인다. 빈 줄보다는 낫다.
      captionKo: koreanOnly(parsed.caption_ko) || parsed.caption,
      textInPhoto: parsed.text_in_photo,
      signText: address ? address.text : null,
      signRaw: address?.correction ? address.correction.from : null,
      signExists: address ? address.exists : null,
      roadKnown: address ? address.known : null,
      ms,
      inputTokens: seen.inputTokens,
      outputTokens: seen.outputTokens,
      eye: seen.eye,
      model: seen.model,
    };
  });
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

/**
 * 한국어 설명에 섞여 온 다른 문자(아랍·히브리·태국·키릴·가나·한자)를 걷어 낸다.
 * 모델이 「교통 콘」을 아랍어로 적어 보낸 날이 있었다. 번역하지 않고 그 낱말만 뺀다. 빈 칸이 낫다.
 */
export function koreanOnly(text: string): string {
  return text
    .replace(/[Ѐ-ӿ֐-׿؀-ۿݐ-ݿ฀-๿぀-ヿ一-鿿]+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.·])/g, "$1")
    .trim();
}
