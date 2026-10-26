import { laneLabel } from "./lanes";
import type { Group } from "./types";

/**
 * 일지 한 장의 **자리(슬롯)**. 양식이 무엇이든 담기는 값은 이것뿐이다.
 *
 *   개요  일시 · 순찰자 · 지역
 *   세부  계절특수 · 위험시설물 · 주민소통 · 순찰사항 · 특이사항, 각각 줄 목록
 *   사진  (사진, 위치) 목록
 *
 * 기본 양식도, 부서 양식도 이 값을 그린다. 화면의 일지 글(사람이 고친 것 포함)이 원천이고,
 * 이 파일은 그 글을 자리로 나누는 일만 한다. 글을 새로 짓지 않는다.
 *
 * 이 파일은 브라우저에서도 돈다.
 */

export interface IljiRows {
  seasonal: string[];
  facility: string[];
  community: string[];
  patrol: string[];
  etc: string[];
}

/** 한 자리의 사진. 정비 전과 정비 후. 둘 다 셀 비율로 잘라 둔 JPEG 이고, 없으면 null(빈 칸). */
export interface IljiPhoto {
  caption: string;
  /** 그 자리의 란 이름(순찰사항·계절특수 …). 사진 표 머리에 같이 적는다. */
  note?: string;
  /**
   * 정비 전·후 짝인가. 순찰사항(청소·정비)만 그렇다. 계절특수·위험시설물은 확인 사진이라
   * 전·후가 없는 날이 많다. 그런 자리는 「현장 확인」 으로 한두 장을 싣는다.
   */
  pair: boolean;
  before: Uint8Array | null;
  after: Uint8Array | null;
}

export interface IljiSlots {
  dong: string;
  unit: string;
  officer: string;
  /** 「2026. 9. 21.(월) (08:32~11:05)」 꼴. 일지 글의 순찰일시 줄에서 온다. */
  dateLabel: string;
  area: string;
  rows: IljiRows;
  /** 란마다 몇 자리였나. 화면의 보고서가 세어 둔 값. 없으면 안 적는다. */
  counts?: Partial<Record<keyof IljiRows, number>>;
  photos: IljiPhoto[];
}

export const EMPTY_ROWS: IljiRows = { seasonal: [], facility: [], community: [], patrol: [], etc: [] };

/**
 * 일지 글 → 자리. 글의 틀은 `report.ts` 가 만든 것이라 머리글로 나눌 수 있다.
 *
 *   □ 순찰개요            ○ 순찰일시: … / ○ 순찰구역: …
 *   □ 순찰사항            → patrol
 *   □ 위험시설물 순찰사항  → facility
 *   □ 계절특수 순찰사항    → seasonal
 *   □ 주민소통            → community (사람이 적었을 때만)
 *   ※ 특이사항: …         → etc
 *
 * 사람이 고친 글도 같은 길로 간다. 머리글을 못 찾은 란은 비워 둔다. 짐작해 채우지 않는다.
 */
export function readReportText(text: string): { dateLabel: string; area: string; rows: IljiRows } {
  const rows: IljiRows = { seasonal: [], facility: [], community: [], patrol: [], etc: [] };
  let dateLabel = "";
  let area = "";
  let target: keyof IljiRows | "header" | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const bare = line.trim();
    if (bare.length === 0) continue;

    if (bare.startsWith("□")) {
      const head = bare.slice(1).replace(/\s+/g, "");
      target =
        head.startsWith("순찰개요") ? "header"
        : head.startsWith("순찰사항") ? "patrol"
        : head.startsWith("위험시설물") ? "facility"
        : head.startsWith("계절특수") ? "seasonal"
        : head.startsWith("주민소통") ? "community"
        : head.startsWith("특이사항") ? "etc"
        : null;
      continue;
    }
    if (bare.startsWith("※") && bare.replace(/\s+/g, "").startsWith("※특이사항")) {
      target = "etc";
      const after = bare.slice(bare.indexOf(":") + 1).trim();
      if (bare.includes(":") && after) rows.etc.push(after);
      continue;
    }
    if (target === "header") {
      const [key, ...rest] = bare.replace(/^○\s*/, "").split(":");
      const value = rest.join(":").trim();
      if (key.replace(/\s+/g, "") === "순찰일시") dateLabel = value;
      else if (key.replace(/\s+/g, "").startsWith("순찰구역") || key.replace(/\s+/g, "").startsWith("순찰지역")) area = value;
      continue;
    }
    if (target) rows[target].push(dedent(line));
  }
  return { dateLabel, area, rows };
}

/**
 * 글의 줄머리는 「  ○ 」·「    - 」·「      · 」로 두 칸씩 들어간다. 셀 안에서는 첫 단계가
 * 칸 왼쪽에 붙어야 하므로 두 칸을 걷어 낸다. 그 아래 단계의 상대 들여쓰기는 그대로 남는다.
 */
function dedent(line: string): string {
  return line.startsWith("  ") ? line.slice(2) : line.replace(/^\s+/, "");
}

export interface PhotoPick {
  /** 어느 묶음의 것인가. 하루치 기록에 자리를 남길 때 묶음과 짝을 맞춘다. */
  groupId: string;
  /** 정비 전 사진 index. 없으면 null. */
  before: number | null;
  /** 정비 후 사진 index. 없으면 null. */
  after: number | null;
  caption: string;
  /** 란 이름. */
  note: string;
  /** 정비 전·후 짝인가(순찰사항만). 아니면 before·after 는 그저 첫 장·둘째 장이다. */
  pair: boolean;
}

/**
 * 자리마다 일지에 실을 사진 두 장, 정비 전과 정비 후.
 *
 * 주소판은 뺀다(주소는 글로 적혔다). **순찰사항**은 정비 전·후 짝이다. 판정이 「전」쪽으로 본 장 가운데 **첫 장**이 전,
 * 「후」쪽으로 본 장 가운데 **마지막 장**이 후다. 판정이 없으면(직접 적는 길) 첫 장이 전, 마지막 장이 후, 한 장뿐이면 후다.
 * **다른 란**은 확인 사진이라 전·후가 없다. 첫 장과 둘째 장을 차례로 싣는다.
 * 갈래가 안 정해진 자리는 일지 글에도 없으므로 사진도 싣지 않는다.
 *
 * `plateAt` 과 `stageScore` 는 판정에서 온다. 판정이 없으면 거짓·0 을 주면 된다.
 *
 * `tailPlate` 는 판정이 없는 길(직접 적는 길)에서 켠다. 그 길은 한 자리를 전·후·주소판 차례의 석 장으로 본다
 * (`manual.groupSize`). 주소판을 가려낼 판정이 없으니 **석 장 이상인 자리의 마지막 장을 주소판으로 보고 뺀다.**
 * 안 빼면 「마지막 장이 후」 규칙이 주소판을 후 칸에 넣는다. 두 장뿐인 자리는 그대로 전·후다.
 *
 * **주소판이 둘 이상으로 나온 자리**는 그중 전이나 후로 기운 장을 작업 사진으로 되돌린다. 작업 사진 구석에 길 표지나
 * 옆 건물 주소판이 잡히면 그 장이 주소판으로 빠지고, 전·후 짝의 한쪽이 빈다(10-03 실물: 전 0.71 인 장에서 길 표지를
 * 읽어 전 칸이 비었다). 진짜 주소판은 「해당 없음」으로 나오므로 남는다. 짝이 이미 섰으면 건드리지 않는다.
 *
 * **사람이 정한 쓰임(`group.roles`)이 판정보다 먼저다.** 전·후로 정한 장은 그 칸에 들어가고 주소판으로 빠지지 않는다.
 * 「싣지 않음」으로 정한 장은 고르지 않는다. 나머지 칸은 종전 규칙이 채운다.
 */
/** 이 확신부터는 판정이 찍은 차례를 거슬러도 믿는다. 묶기의 `workShot` 과 같은 값이다. */
const SURE_STAGE = 0.8;

export function pickPhotos(
  groups: Group[],
  plateAt: (index: number) => boolean,
  stageScore: (index: number, stage: "before" | "after") => number,
  tailPlate = false,
): PhotoPick[] {
  const picks: PhotoPick[] = [];
  for (const group of groups) {
    if (group.lane === "unknown" || group.lane === "none_of_these") continue;
    if (group.photos.length === 0) continue;
    const caption = group.address.trim() || "주소 미기재";
    const note = laneLabel(group.lane);
    const pair = group.lane === "waste_cleanup";
    const groupId = group.id;

    const roleOf = (index: number) => group.roles?.[index];
    const forced = (role: "before" | "after") => group.photos.find((index) => roleOf(index) === role) ?? null;
    const forcedBefore = forced("before");
    const forcedAfter = forced("after");
    // 사람이 쓰임을 정한 장은 아래 규칙의 재료에서 뺀다. 전·후로 정한 장은 마지막에 그 칸으로 들어간다.
    const open = group.photos.filter((index) => roleOf(index) === undefined);

    const tail = tailPlate && group.photos.length >= 3 ? group.photos[group.photos.length - 1] : null;
    const plates = open.filter((index) => plateAt(index));
    let candidates = open.filter((index) => !plateAt(index) && index !== tail);
    // 사람이 채운 칸까지 세어도 짝이 안 서고 주소판이 둘 이상이면, 전이나 후로 기운 주소판을 작업 사진으로 되돌린다.
    const filled = candidates.length + (forcedBefore !== null ? 1 : 0) + (forcedAfter !== null ? 1 : 0);
    if (pair && filled < 2 && plates.length >= 2) {
      const leaning = plates.filter((index) => stageScore(index, "before") > 0 || stageScore(index, "after") > 0);
      // 주소판 한 장은 남긴다. 전부 기울었으면 맨 뒤 장을 주소판으로 둔다.
      const back = new Set(leaning.length === plates.length ? leaning.slice(0, -1) : leaning);
      if (back.size > 0) candidates = open.filter((index) => (!plateAt(index) || back.has(index)) && index !== tail);
    }
    const anyForced = forcedBefore !== null || forcedAfter !== null;
    // 가려낼 것이 하나도 안 남으면 있는 장으로 채운다. 다만 사람이 칸을 정해 둔 자리에서는 빼 둔 장을 다시 넣지 않는다.
    const pool = candidates.length > 0 || anyForced ? candidates : open.length > 0 ? open : [];

    if (anyForced) {
      // 사람이 정한 칸이 먼저. 남은 한 칸은 차례로 메운다(전은 앞에서, 후는 뒤에서).
      const before = forcedBefore ?? pool.find((index) => index !== forcedAfter) ?? null;
      const after = forcedAfter ?? [...pool].reverse().find((index) => index !== before) ?? null;
      picks.push({ groupId, before, after, caption, note, pair });
      continue;
    }
    if (pool.length === 0) {
      picks.push({ groupId, before: null, after: null, caption, note, pair });
      continue;
    }

    if (!pair) {
      picks.push({ groupId, before: pool[0], after: pool[1] ?? null, caption, note, pair });
      continue;
    }
    if (pool.length === 1) {
      const only = pool[0];
      const isBefore = stageScore(only, "before") > stageScore(only, "after");
      picks.push({ groupId, before: isBefore ? only : null, after: isBefore ? null : only, caption, note, pair });
      continue;
    }

    // 차례가 먼저다. 한 자리에서는 치우기 전을 먼저 찍고 치운 뒤를 나중에 찍는다. 판정은 어느 장이
    // 「전」쪽인지 「후」쪽인지만 말하게 하고, 같은 쪽이 여럿이면 차례로 가른다(전은 첫 장, 후는 마지막 장).
    // 09-28 실물(22장): 사람 둘이 쓸고 있는 장이 「후」 0.81, 그 뒤 빈 골목이 「후」 0.73 로 나왔다. 확률이 높은
    // 장을 후로 삼으니 쓸고 있는 장이 후 칸에, 빈 골목이 전 칸에 들어가 전·후가 뒤집혔다. 차례로 가르면 바로 선다.
    const leans = (index: number, stage: "before" | "after") => {
      const mine = stageScore(index, stage);
      const other = stageScore(index, stage === "before" ? "after" : "before");
      return mine > 0 && mine >= other;
    };
    const befores = pool.filter((index) => leans(index, "before"));
    const afters = pool.filter((index) => leans(index, "after"));
    let before: number | null = befores[0] ?? null;
    let after: number | null = afters.length > 0 ? afters[afters.length - 1] : null;
    if (before !== null && after !== null && before === after) after = null;
    // 판정이 차례를 거스르면(후로 본 장이 전으로 본 장보다 앞) 둘 다 분명할 때만 판정을 믿는다.
    // 그렇지 않으면 차례가 이긴다. 찍은 차례는 판정보다 곧은 증거다.
    if (before !== null && after !== null && pool.indexOf(after) < pool.indexOf(before)) {
      const sure = stageScore(before, "before") >= SURE_STAGE && stageScore(after, "after") >= SURE_STAGE;
      if (!sure) {
        before = null;
        after = null;
      }
    }
    // 판정이 없거나 한쪽만 섰으면 차례로 메운다. 전이 먼저, 후가 나중이다.
    if (before === null) before = pool.find((index) => index !== after) ?? null;
    if (after === null) after = [...pool].reverse().find((index) => index !== before) ?? null;
    picks.push({ groupId, before, after, caption, note, pair });
  }
  return picks;
}

/** 고른 사진 짝에서 사람이 한 번 볼 만한 것. 보고서에 적지 않고 화면이 그 자리를 짚는 데만 쓴다. */
export type PickDoubt = "swap" | "plate";

/**
 * 전·후 칸에 실린 장을 판정과 견준다. 고르는 규칙은 그대로 두고, 규칙이 판정을 거슬렀거나 가려낼 것이 없어
 * 주소판을 실은 자리만 알린다. 사람이 쓰임을 정한 장은 묻지 않는다.
 *
 *   swap   전 칸의 장을 판정은 「후」로, 후 칸의 장을 「전」으로 봤다. 찍은 차례를 믿고 실었지만, 시각을 모르는
 *          사진은 올라온 차례가 찍은 차례가 아닐 수 있다(10-03 실물: 치운 뒤가 전 칸에, 치우기 전이 후 칸에 실렸다).
 *   plate  사진 칸에 주소판으로 본 장이 실렸다. 그 자리에 작업 사진이 모자랐다는 뜻이다.
 */
export function pickDoubts(
  group: Group,
  pick: Pick<PhotoPick, "before" | "after" | "pair">,
  plateAt: (index: number) => boolean,
  stageScore: (index: number, stage: "before" | "after") => number,
): PickDoubt[] {
  const out: PickDoubt[] = [];
  const free = (index: number | null): index is number => index !== null && group.roles?.[index] === undefined;
  if (pick.pair && free(pick.before) && free(pick.after)) {
    const beforeLooksAfter = stageScore(pick.before, "after") > stageScore(pick.before, "before");
    const afterLooksBefore = stageScore(pick.after, "before") > stageScore(pick.after, "after");
    if (beforeLooksAfter && afterLooksBefore) out.push("swap");
  }
  if ((free(pick.before) && plateAt(pick.before)) || (free(pick.after) && plateAt(pick.after))) out.push("plate");
  return out;
}
