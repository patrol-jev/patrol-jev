import { createHash } from "node:crypto";
import { SLOT_LABELS, type SlotKey } from "./form-slots";
import { normalizeLabel, type CellInfo, type CellRef, type HwpxDoc } from "./hwpx/read";

/**
 * 부서 양식의 **칸 지도**. 양식 hwpx 를 읽어 「어느 셀이 어느 자리인가」를 정한다.
 *
 * 규칙은 셋이다.
 *   1. 라벨은 짧은 글자가 든 셀이고, 값은 그 **오른쪽**(없으면 아래) 셀이다.
 *   2. 라벨과 자리는 사전으로 잇되, **한 자리에 라벨이 둘 이상 걸리면 잇지 않는다.**
 *      찍어서 맞힌 지도는 안 맞힌 것만 못하다. 그 자리는 비워 두고 사람에게 알린다.
 *   3. 사진 칸은 비어 있고 큰 셀, 또는 이미 그림이 깔린 셀이다. 그 바로 아래 낮은 셀이 설명 칸이다.
 *
 * 이 파일은 **서버에서만** 돈다. 사전과 규칙이 여기 있다.
 */

export { SLOT_LABELS, type SlotKey };

/** 자리마다 받아 주는 라벨. 앞에 올수록 센 것이 아니라 전부 같은 값이고, 견주는 방식이 셋으로 갈린다. */
const DICTIONARY: Record<SlotKey, string[]> = {
  dateLabel: ["순찰일시", "점검일시", "순찰일자", "점검일자", "일시", "일자", "날짜", "순찰기간"],
  officer: ["순찰자", "점검자", "순찰인원", "순찰반", "담당자", "작성자", "참여자", "순찰조", "점검반"],
  area: ["순찰지역", "점검지역", "순찰구역", "점검구역", "순찰장소", "점검장소", "순찰코스", "순찰노선", "순찰구간", "지역", "구역", "장소"],
  seasonal: ["계절특수순찰사항", "계절특수", "계절별순찰사항", "계절별", "풍수해", "폭염", "한파"],
  facility: ["위험시설물순찰사항", "위험시설물", "위험시설", "시설물점검", "시설물", "위험요소", "안전시설"],
  community: ["주민소통", "주민면담", "주민의견", "민원사항", "민원", "소통"],
  patrol: ["순찰사항", "순찰내용", "순찰결과", "순찰실적", "점검사항", "점검내용", "점검결과", "조치사항", "조치내용", "조치결과"],
  etc: ["특이사항", "특기사항", "기타사항", "기타", "비고", "건의사항"],
};

/** 라벨로 볼 글자 길이 상한(정규화 뒤). 이보다 길면 본문이다. */
const LABEL_MAX = 14;
/** 사진 칸으로 볼 최소 크기(HWPUNIT). 가로 10000 ≈ 3.5cm, 세로 8000 ≈ 2.8cm. */
const PHOTO_MIN = { width: 10000, height: 8000 };
/** 설명 칸으로 볼 최대 높이. */
const CAPTION_MAX_HEIGHT = 4500;

/**
 * 사진 한 자리. 셀이 둘이면 정비 전·후(한 설명 칸을 나눠 쓰는 나란한 두 칸), 하나면 한 장.
 */
export interface PhotoSlot {
  cells: CellRef[];
  /** 바로 아래 설명 칸. 없으면 null. */
  caption: CellRef | null;
}

export interface FormMap {
  version: 1;
  /** 표 꼴과 라벨로 만든 지문. 같은 양식이면 같다. 값·이름은 안 들어간다. */
  fingerprint: string;
  grade: "A" | "B" | "C";
  text: Partial<Record<SlotKey, CellRef>>;
  /** 이미 글자가 들어 있는 값 칸. 작성본을 올렸을 때 알려 주려고 둔다. */
  prefilled: SlotKey[];
  photos: PhotoSlot[];
  /** 사진 칸의 가로/세로. 브라우저가 이 비율로 사진을 자른다. 사진 칸이 없으면 1.25. */
  photoRatio: number;
  /** 못 이은 자리. 화면이 이름으로 알린다. */
  missing: SlotKey[];
  /** 라벨이 둘 이상 걸려 일부러 안 이은 자리. */
  ambiguous: SlotKey[];
  /** 양식에서 읽은 라벨 원문(정규화 전). 구조 보내기에 쓴다. 값은 없다. */
  labels: string[];
  /** 표마다 [행, 열, 너비]. 구조 보내기에 쓴다. */
  shapes: [number, number, number][];
}

export function mapForm(doc: HwpxDoc): FormMap {
  const cells = doc.tables.flatMap((t) => t.cells);
  const byRef = new Map(cells.map((c) => [key(c), c]));

  // ── 라벨 후보와 그 값 칸.
  const labels = cells.filter((c) => {
    const norm = normalizeLabel(c.text);
    return norm.length > 0 && norm.length <= LABEL_MAX && !c.hasImage && !isCountish(norm);
  });
  const labelNorms = new Set(labels.map((c) => normalizeLabel(c.text)));
  const valueOf = (label: CellInfo): CellInfo | null => {
    const right = byRef.get(key({ ...label, col: label.col + label.colSpan }));
    const below = byRef.get(key({ ...label, row: label.row + label.rowSpan }));
    // 머리띠 꼴(이름 | 개소 수, 그 아래 병합된 본문)이면 아래가 값이다.
    if (below && !isLabelLike(below, labelNorms) && below.colSpan > label.colSpan && below.height > label.height) return below;
    if (right && !isLabelLike(right, labelNorms)) return right;
    if (below && !isLabelLike(below, labelNorms)) return below;
    return null;
  };

  const text: Partial<Record<SlotKey, CellRef>> = {};
  const prefilled: SlotKey[] = [];
  const missing: SlotKey[] = [];
  const ambiguous: SlotKey[] = [];
  const claimed = new Set<string>();

  // 정확 > 앞머리 > 포함. 앞 단계에서 이은 것은 뒤 단계에서 다시 안 본다.
  const passes: Array<(norm: string, word: string) => boolean> = [
    (norm, word) => norm === word,
    (norm, word) => norm.startsWith(word),
    (norm, word) => norm.includes(word),
  ];
  const slots = Object.keys(DICTIONARY) as SlotKey[];
  for (const pass of passes) {
    for (const slot of slots) {
      if (text[slot] || ambiguous.includes(slot)) continue;
      const hits = labels.filter((c) => {
        if (claimed.has(key(c))) return false;
        const norm = normalizeLabel(c.text);
        return DICTIONARY[slot].some((word) => pass(norm, word));
      });
      if (hits.length === 0) continue;
      if (hits.length > 1) {
        // 같은 글자가 두 번 나오는 양식(앞뒤 쪽)이라면 첫 것을 쓰되, 다른 글자끼리 걸렸으면 잇지 않는다.
        const distinct = new Set(hits.map((c) => normalizeLabel(c.text)));
        if (distinct.size > 1) {
          ambiguous.push(slot);
          continue;
        }
      }
      const label = hits[0];
      const value = valueOf(label);
      if (!value) continue;
      text[slot] = ref(value);
      claimed.add(key(label));
      claimed.add(key(value));
      if (value.text.trim().length > 0) prefilled.push(slot);
    }
  }
  for (const slot of slots) if (!text[slot] && !ambiguous.includes(slot)) missing.push(slot);

  // ── 사진 칸. 나란한 두 칸이 한 자리(전·후)인지는 셋 중 하나로 안다.
  //    ① 아래 설명 칸 하나를 나눠 쓴다  ② 위에 두 칸을 덮는 머리 칸이 있다  ③ 아래 칸 글자가 「정비 전」「정비 후」 꼴이다
  const photoCells = cells.filter((c) => {
    if (claimed.has(key(c))) return false;
    const big = c.width >= PHOTO_MIN.width && c.height >= PHOTO_MIN.height;
    return c.hasImage || (big && c.text.trim().length === 0);
  });
  const isPhoto = new Set(photoCells.map(key));
  const captionable = (cell: CellInfo | undefined): cell is CellInfo =>
    Boolean(cell) &&
    cell!.height <= CAPTION_MAX_HEIGHT &&
    normalizeLabel(cell!.text).length <= 30 &&
    !isLabelLike(cell!, labelNorms) &&
    !isStageMarker(cell!.text);
  const photos: PhotoSlot[] = [];
  const used = new Set<string>();
  for (const c of photoCells) {
    if (used.has(key(c))) continue;
    used.add(key(c));
    const right = byRef.get(key({ ...c, col: c.col + c.colSpan }));
    const belowL = covering(cells, c.sec, c.tbl, c.row + c.rowSpan, c.col);
    const above = c.row > 0 ? covering(cells, c.sec, c.tbl, c.row - 1, c.col) : undefined;
    let pair = false;
    if (right && isPhoto.has(key(right)) && !used.has(key(right))) {
      const belowR = covering(cells, c.sec, c.tbl, right.row + right.rowSpan, right.col);
      const sharedBelow = Boolean(belowL && belowR && key(belowL) === key(belowR));
      const headAbove = Boolean(above && above.col <= c.col && right.col < above.col + above.colSpan);
      const markers = Boolean(belowL && belowR && isStageMarker(belowL.text) && isStageMarker(belowR.text));
      pair = sharedBelow || headAbove || markers;
    }
    if (pair && right) {
      used.add(key(right));
      // 설명 칸: 두 칸을 덮는 머리 칸이 있으면 그것, 없으면 나눠 쓰는 아래 칸.
      const head = above && above.col <= c.col && right.col < above.col + above.colSpan && captionable(above) ? above : undefined;
      const caption = head ?? (captionable(belowL) ? belowL : undefined);
      photos.push({ cells: [ref(c), ref(right)], caption: caption ? ref(caption) : null });
      continue;
    }
    photos.push({ cells: [ref(c)], caption: captionable(belowL) ? ref(belowL) : null });
  }
  const photoRatio =
    photoCells.length > 0
      ? photoCells.reduce((sum, c) => sum + c.width / Math.max(1, c.height), 0) / photoCells.length
      : 1.25;

  const shapes = doc.tables.map((t) => [t.rows, t.cols, t.width] as [number, number, number]);
  // 라벨 원문. 값 칸과 사진 설명 칸은 뺀다(작성본을 올리면 값·주소가 짧은 글자로 섞여 들어온다).
  const valueKeys = new Set([
    ...Object.values(text).map((r) => key(r)),
    ...photos.flatMap((p) => (p.caption ? [key(p.caption)] : [])),
  ]);
  const labelTexts = labels.filter((c) => !valueKeys.has(key(c))).map((c) => c.text.replace(/\s+/g, " ").trim());
  // 지문은 표 꼴과 **사전에 걸린 라벨**로만. 그래야 빈 양식과 작성본이 같은 지문이다.
  const claimedLabels = labels.filter((c) => claimed.has(key(c)) && !valueKeys.has(key(c))).map((c) => normalizeLabel(c.text));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ shapes, labels: claimedLabels }))
    .digest("hex")
    .slice(0, 12);

  return {
    version: 1,
    fingerprint,
    grade: gradeOf(text, photos),
    text,
    prefilled,
    photos,
    photoRatio: Math.round(photoRatio * 1000) / 1000,
    missing,
    ambiguous,
    labels: labelTexts,
    shapes,
  };
}

/**
 * 등급. A = 일시·순찰사항이 이어지고 자리 다섯 이상에 사진 칸도 있다.
 * B = 글 칸은 됐는데 사진 칸이 없다. C = 그 아래. 어느 등급이든 산출은 나가고, 못 이은 것은 이름으로 알린다.
 */
function gradeOf(text: Partial<Record<SlotKey, CellRef>>, photos: PhotoSlot[]): "A" | "B" | "C" {
  const core = Boolean(text.dateLabel && text.patrol);
  const count = Object.keys(text).length;
  if (core && count >= 5 && photos.length > 0) return "A";
  if (core && count >= 3) return "B";
  return "C";
}

function isLabelLike(cell: CellInfo, labelNorms: Set<string>): boolean {
  const norm = normalizeLabel(cell.text);
  if (norm.length === 0 || norm.length > LABEL_MAX) return false;
  // 사전에 있는 말이거나, 같은 양식 안에서 라벨 꼴로 쓰인 말.
  return labelNorms.has(norm) && Object.values(DICTIONARY).some((words) => words.some((w) => norm.includes(w)));
}

/** 「6개소」「17/19」처럼 숫자가 앞서는 값. 라벨이 아니다. */
function isCountish(norm: string): boolean {
  return /^\d+[가-힣a-z%]{0,2}$/i.test(norm) || /^\d+\/\d+$/.test(norm);
}

/** 「정비 전」「조치 후」「전」「후」처럼 사진 칸 아래 붙는 표시 글자. 설명 칸이 아니라 라벨이다. */
function isStageMarker(text: string): boolean {
  const norm = normalizeLabel(text);
  return /^(정비|조치|청소|처리|작업|점검)?(전|후)$/.test(norm) || /^(before|after)$/i.test(norm);
}

/** 그 표의 그 행에서 이 열을 덮는 셀. 병합된 칸을 찾을 때 쓴다. */
function covering(cells: CellInfo[], sec: number, tbl: number, row: number, col: number): CellInfo | undefined {
  return cells.find((c) => c.sec === sec && c.tbl === tbl && c.row === row && c.col <= col && col < c.col + c.colSpan);
}

function key(c: CellRef): string {
  return `${c.sec}:${c.tbl}:${c.row}:${c.col}`;
}

function ref(c: CellInfo): CellRef {
  return { sec: c.sec, tbl: c.tbl, row: c.row, col: c.col };
}
