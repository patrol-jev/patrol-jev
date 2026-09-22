import { choice, noul } from "@typesafe-ai/sdk";

/**
 * 판단은 전부 이 파일 한 장에 있다.
 *
 * 사람이 검토할 것은 코드가 아니라 **질문의 문장과 문턱값**이다. 그래서 흩어 두지 않았다.
 * 고칠 일이 생기면 여기만 고치면 된다.
 *
 * 질문을 영어로 쓴 까닭 — Jev 문서가 「English is the primary training language and where
 * accuracy is currently best」라고 적고 있다. 그래서 **모델에게 묻는 말은 영어**로 두고,
 * 화면과 일지에 나가는 **사람의 말은 한국어**로 둔다. 사진에서 읽은 한글 글자는
 * 번역하지 않고 원문 그대로 state 에 넣는다(주소는 옮기는 순간 틀린다).
 */

export { LANES, LANE_ORDER, type Lane, type LaneOrUnknown } from "./lanes";

/** 한 장에 대해 Jev 에게 보내는 state. 사람 정보는 담기지 않는다. */
export type PhotoState = {
  photo: {
    index: number;
    /** 생성 모델이 영어로 옮겨 적은 장면. 판단은 영어가 정확해서 이쪽을 넘긴다. */
    caption: string;
    /** 사진에서 읽은 글자 원문(한글 그대로). 없으면 null. */
    text_in_photo: string | null;
    /** 주소판으로 보이는 글자 원문. 없으면 null. */
    sign_text: string | null;
  };
  previous_photo: {
    index: number;
    caption: string;
    /** 앞 장과의 분 차이. 모르면 null — 모른다는 것을 모른다고 적는다. */
    minutes_before: number | null;
  } | null;
};

/**
 * 한 번의 요청에 이 질문들을 같이 보낸다.
 * 서로 독립이라 **병렬로 답이 오고, 서로의 답을 보지 못한다** — 그게 이 모델의 쓰임새다.
 */
export const BASE_QUESTIONS = {
  lane: choice(
    "Which section of a district office street-patrol log should this photo be filed under? Judge only from `photo.caption` and `photo.text_in_photo`.",
    {
      waste_cleanup:
        "Street or alley waste work: litter, bagged refuse, dumped household items, a dustpan, broom or cart in use, or a stretch of road or alley shown before or after it was cleared.",
      flood_season:
        "A rainy-season facility being checked: a storm drain, gutter, catch basin, drainage grate, or a public sunshade canopy over a crossing.",
      risk_facility:
        "A structure that might be unsafe: a cracked or bulging wall, a retaining wall, a leaning or damaged building, broken or sunken road surface, a loose sign or something at risk of falling.",
      none_of_these:
        "None of the above clearly applies. Includes a photo that is only an address plate, a photo that is too dark or blurred to judge, and anything unrelated to street patrol.",
    },
  ),

  // 생성 모델이 읽어 온 글자가 정말 주소인지 되묻는다.
  // 간판·상호·전화번호를 주소로 적는 것이 실무에서 가장 잦은 사고였다.
  address_plate: noul(
    {
      sign_text: "`photo.sign_text`",
      question:
        "Is `photo.sign_text` a Korean road-name address read off a street address plate — a road name followed by a building number — rather than some other text in the scene?",
    },
    {
      true: "A road name plus a building number, as printed on a blue road-name address plate.",
      false:
        "A shop or business name, a person's name, a phone number, a notice, a vehicle plate, or nothing was read at all.",
    },
  ),

  stage: choice(
    "Does this photo record the state before the work, or after it?",
    {
      before:
        "Waste, clutter or damage is still present at the spot — this is the 'before' record.",
      after:
        "The spot is cleared and tidy, or the work is finished — this is the 'after' record.",
      not_applicable:
        "Not a before/after pair at all — for example an address plate, or a facility being checked rather than cleaned.",
    },
  ),
};

/**
 * 묶기(청킹)를 사람의 눈 대신 여기서 판단한다.
 * 첫 장에는 앞 장이 없으니 **묻지 않는다** — 답할 수 없는 질문을 보내면 답이 지어내진다.
 */
export const SAME_LOCATION_QUESTION = noul(
  "Were `photo` and `previous_photo` taken at the same spot — the same street, alley or building frontage — rather than at a different spot further along the route? Weigh `previous_photo.minutes_before`, the gap between the two shots, together with the scene itself.",
  {
    true: "Same buildings, same alley, same road surface — the camera has not moved to a new spot. Two shots a minute or two apart are usually one spot photographed twice — before and after the work, or from a second angle — even when the two captions read quite differently.",
    false:
      "The surroundings have clearly changed: different buildings or shopfronts, a different road width or surface, a different landmark. A gap of many minutes points this way, since the patrol walks on between spots.",
  },
);

/**
 * 생성 모델에게 주는 지시. 판단을 시키지 않는다 — **본 것만 적게 한다.**
 * 분류는 Jev 가 하고, 문장은 코드가 만든다. 이 모델의 몫은 「사진 → 글」뿐이다.
 */
export const VISION_SYSTEM = `You convert one street-patrol photo into plain facts. You do not classify, judge, guess or advise.

Return JSON only, exactly this shape:
{"caption": "...", "caption_ko": "...", "text_in_photo": "..." | null, "sign_text": "..." | null}

caption — one or two plain English sentences describing only what is visibly in the frame: the surroundings, the road or alley, any waste, equipment, structure or facility, and whether the spot looks cleared or not. No speculation about what happened before or after. No opinion about risk or severity.

caption_ko — the same one or two sentences in Korean, for the person who took the photo to read on screen. Plain report Korean, noun-ending style. Same facts as caption, nothing added.

text_in_photo — every legible character you can read anywhere in the frame, copied verbatim in its original script. Do not translate, transliterate, correct or normalise. null if nothing is legible.

sign_text — the text of a Korean road-name address plate if and only if one is in the frame: a blue pentagonal or rectangular sign carrying a road name above and a building number below. Copy the Korean exactly as printed, road name then building number, e.g. "○○로12길 34". Rules:
- Read the Korean line. Any romanised line underneath is only a cross-check; if they disagree, trust the Korean.
- Copy digits exactly. A three-digit building number stays three digits; do not split it into a road-number and a smaller number.
- If the road name is too small to read but the building number is legible, give the building number alone.
- A shop sign, a banner, a phone number, a person's name or a vehicle plate is never a sign_text. Use null.
- If no address plate is in the frame, sign_text is null. Never infer an address from the surroundings.`;

/** 그 동에서 자주 나오는 도로명을 **참고로만** 덧붙인다. 목록에 맞추라고 시키지 않는다. */
export function visionSystemFor(roads: string[]): string {
  if (roads.length === 0) return VISION_SYSTEM;
  return `${VISION_SYSTEM}

Road names that occur often in this district, as a reading aid only — this is not a whitelist and the district has many more. Never bend what you read towards this list; a plate you read clearly is correct even if it is absent here:
${roads.join(", ")}`;
}
