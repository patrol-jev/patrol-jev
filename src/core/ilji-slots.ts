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
 * 주소판은 뺀다(주소는 글로 적혔다). **순찰사항**은 정비 전·후 짝이다. 판정이 「전」이라고 본 장을 전에,
 * 「후」라고 본 장을 후에 두고, 판정이 없으면(직접 적는 길) 첫 장이 전, 마지막 장이 후, 한 장뿐이면 후다.
 * **다른 란**은 확인 사진이라 전·후가 없다. 첫 장과 둘째 장을 차례로 싣는다.
 * 갈래가 안 정해진 자리는 일지 글에도 없으므로 사진도 싣지 않는다.
 *
 * `plateAt` 과 `stageScore` 는 판정에서 온다. 판정이 없으면 거짓·0 을 주면 된다.
 */
export function pickPhotos(
  groups: Group[],
  plateAt: (index: number) => boolean,
  stageScore: (index: number, stage: "before" | "after") => number,
): PhotoPick[] {
  const picks: PhotoPick[] = [];
  for (const group of groups) {
    if (group.lane === "unknown" || group.lane === "none_of_these") continue;
    if (group.photos.length === 0) continue;
    const candidates = group.photos.filter((index) => !plateAt(index));
    const pool = candidates.length > 0 ? candidates : group.photos;
    const caption = group.address.trim() || "주소 미기재";
    const note = laneLabel(group.lane);
    const pair = group.lane === "waste_cleanup";

    if (!pair) {
      picks.push({ before: pool[0], after: pool[1] ?? null, caption, note, pair });
      continue;
    }
    if (pool.length === 1) {
      const only = pool[0];
      const isBefore = stageScore(only, "before") > stageScore(only, "after");
      picks.push({ before: isBefore ? only : null, after: isBefore ? null : only, caption, note, pair });
      continue;
    }

    const best = (stage: "before" | "after", except: number | null) => {
      let found: number | null = null;
      let top = 0;
      for (const index of pool) {
        if (index === except) continue;
        const score = stageScore(index, stage);
        if (score > top) {
          found = index;
          top = score;
        }
      }
      return found;
    };
    let after = best("after", null);
    let before = best("before", after);
    // 판정이 없거나 한쪽만 섰으면 차례로 메운다. 전이 먼저, 후가 나중이다.
    if (before === null) before = pool.find((index) => index !== after) ?? null;
    if (after === null) after = [...pool].reverse().find((index) => index !== before) ?? null;
    picks.push({ before, after, caption, note, pair });
  }
  return picks;
}
