import { createHash } from "node:crypto";
import { normalizeLabel, type CellInfo, type CellRef, type HwpxDoc, type TableInfo } from "./hwpx/read";
import { CATEGORY_ROWS } from "./period";

/**
 * 결과 보고서 부서 양식의 **칸 지도**. 일지 양식(`form-map.ts`)과 달리 이 양식은 「라벨 → 옆 값 칸」이 아니라
 * **표 네 종류**로 되어 있다. 표마다 머리글로 알아본다.
 *
 *   제목      1×1 표에 「보고서」가 든 것. 「○○동」 앞은 기간, 뒤는 꼬리(환경순찰 결과 보고서)로 다시 쓴다.
 *   총계      머리줄에 총계 · 정비요청 · 자체정비가 있는 두 줄 표. 값은 둘째 줄.
 *   항목표    머리줄에 구분 · 내용 · 정비요청 · 자체정비. 줄마다 「구분 + 내용」을 `CATEGORY_ROWS` 에 잇는다.
 *            괄호 안은 걷어 내고 견주므로 「기타(자체정비 포함)」는 구분으로 가른다. 못 이은 줄은 빈 칸으로 남는다.
 *   정비요청  머리줄에 연번 · 요청내역(또는 요청부서). 열은 라벨로 찾고, 줄 수가 곧 실을 수 있는 건수다.
 *   자리 표   「전」「후」 라벨과 「위치」 라벨이 든 표. 연번 · 위치 · 정비내역 · 문서번호는 라벨 오른쪽 칸,
 *            사진은 「전」「후」 바로 아래 칸. 자리가 표보다 많으면 채우기가 마지막 표를 복제한다.
 *   현안보고  건드리지 않는다. 이 도구가 아는 값이 없다.
 *
 * 이 파일은 **서버에서만** 돈다. 09-28 실물 양식(표 12개)으로 만들었다.
 */

export interface SpotTable {
  sec: number;
  tbl: number;
  no: CellRef | null;
  address: CellRef | null;
  work: CellRef | null;
  doc: CellRef | null;
  before: CellRef | null;
  after: CellRef | null;
}

export interface RequestTable {
  sec: number;
  tbl: number;
  /** 첫 값 줄. */
  firstRow: number;
  /** 값 줄 수. 이보다 많은 건은 못 싣는다. */
  rows: number;
  cols: Partial<Record<"no" | "group" | "dept" | "address" | "text" | "doc", number>>;
}

export interface PeriodFormMap {
  version: 1;
  /** 표 꼴과 머리글로 만든 지문. 값은 안 들어간다. */
  fingerprint: string;
  grade: "A" | "B" | "C";
  title: { cell: CellRef; text: string } | null;
  totals: { total: CellRef | null; requested: CellRef | null; self: CellRef | null };
  /** `CATEGORY_ROWS` 의 index → 정비요청 칸 · 자체정비 칸. */
  categories: Record<number, { requested: CellRef; self: CellRef }>;
  requests: RequestTable | null;
  /** 자리 표. 문서 차례대로. */
  spots: SpotTable[];
  /** 자리 표 사진 칸의 가로/세로. 없으면 1.16. */
  photoRatio: number;
  /** 못 이은 것. 화면이 이름으로 알린다. */
  missing: string[];
  labels: string[];
  shapes: [number, number, number][];
}

/** 라벨 견주기. 줄머리 기호(∘ · ○ 등)는 일지 사전 정규화가 모르는 것도 있어 먼저 걷어 낸다. */
const norm = (text: string) => normalizeLabel(text.replace(/[∘◦○●•▪■□ㅇ·]/g, " "));

function ref(c: CellInfo): CellRef {
  return { sec: c.sec, tbl: c.tbl, row: c.row, col: c.col };
}

function cellAt(table: TableInfo, row: number, col: number): CellInfo | null {
  return table.cells.find((c) => c.row === row && c.col === col) ?? null;
}

/** 라벨 칸의 오른쪽 값 칸. 병합을 넘어 바로 옆. */
function rightOf(table: TableInfo, label: CellInfo): CellInfo | null {
  return cellAt(table, label.row, label.col + label.colSpan);
}

/** 라벨 칸 바로 아래 칸. */
function belowOf(table: TableInfo, label: CellInfo): CellInfo | null {
  return cellAt(table, label.row + label.rowSpan, label.col);
}

function headerCols(table: TableInfo): Map<string, number> {
  const cols = new Map<string, number>();
  for (const c of table.cells.filter((c) => c.row === 0)) {
    const n = norm(c.text);
    if (n) cols.set(n, c.col);
  }
  return cols;
}

function findHeader(cols: Map<string, number>, words: string[]): number | null {
  for (const [label, col] of cols) if (words.some((w) => label === w || label.includes(w))) return col;
  return null;
}

export function mapPeriodForm(doc: HwpxDoc): PeriodFormMap {
  const missing: string[] = [];

  // ── 제목
  const titleTable = doc.tables.find((t) => t.rows === 1 && t.cols === 1 && t.cells.length === 1 && /보고서/.test(t.cells[0].text));
  const title = titleTable ? { cell: ref(titleTable.cells[0]), text: titleTable.cells[0].text.replace(/\s+/g, " ").trim() } : null;
  if (!title) missing.push("제목");

  // ── 총계
  const totals: PeriodFormMap["totals"] = { total: null, requested: null, self: null };
  const totalsTable = doc.tables.find((t) => {
    if (t.rows !== 2) return false;
    const cols = headerCols(t);
    return findHeader(cols, ["총계"]) !== null && findHeader(cols, ["정비요청"]) !== null && findHeader(cols, ["자체정비"]) !== null;
  });
  if (totalsTable) {
    const cols = headerCols(totalsTable);
    const pick = (words: string[]) => {
      const col = findHeader(cols, words);
      const cell = col === null ? null : cellAt(totalsTable, 1, col);
      return cell ? ref(cell) : null;
    };
    totals.total = pick(["총계"]);
    totals.requested = pick(["기능부서정비요청", "정비요청"]);
    totals.self = pick(["동자체정비", "자체정비"]);
  } else missing.push("총계");

  // ── 항목표
  const categories: PeriodFormMap["categories"] = {};
  const categoryTable = doc.tables.find((t) => {
    if (t.rows < 10) return false;
    const cols = headerCols(t);
    return findHeader(cols, ["구분"]) !== null && findHeader(cols, ["내용"]) !== null && findHeader(cols, ["정비요청"]) !== null && findHeader(cols, ["자체정비"]) !== null;
  });
  if (categoryTable) {
    const cols = headerCols(categoryTable);
    const groupCol = findHeader(cols, ["구분"]) ?? 0;
    const itemCol = findHeader(cols, ["내용"]) ?? 1;
    const reqCol = findHeader(cols, ["정비요청"]) ?? 2;
    const selfCol = findHeader(cols, ["자체정비"]) ?? 3;
    let group = "";
    const rowsOf = CATEGORY_ROWS.map((r) => ({ group: norm(r.group), item: norm(r.item) }));
    const used = new Set<number>();
    for (let row = 1; row < categoryTable.rows; row++) {
      const groupCell = cellAt(categoryTable, row, groupCol);
      if (groupCell && norm(groupCell.text)) group = norm(groupCell.text);
      const itemCell = cellAt(categoryTable, row, itemCol);
      const reqCell = cellAt(categoryTable, row, reqCol);
      const selfCell = cellAt(categoryTable, row, selfCol);
      if (!itemCell || !reqCell || !selfCell) continue;
      const item = norm(itemCell.text);
      if (!item) continue;
      // 정확 > 앞머리. 같은 구분 안에서만. 이미 이은 줄은 다시 안 쓴다.
      let index = rowsOf.findIndex((r, i) => !used.has(i) && r.group === group && r.item === item);
      if (index < 0) index = rowsOf.findIndex((r, i) => !used.has(i) && r.group === group && (r.item.startsWith(item) || item.startsWith(r.item)));
      if (index < 0) continue;
      used.add(index);
      categories[index] = { requested: ref(reqCell), self: ref(selfCell) };
    }
  } else missing.push("항목표");
  const categoryCount = Object.keys(categories).length;
  if (categoryTable && categoryCount < CATEGORY_ROWS.length) missing.push(`항목표 ${CATEGORY_ROWS.length - categoryCount}줄`);

  // ── 정비요청 세부내역
  let requests: RequestTable | null = null;
  const requestTable = doc.tables.find((t) => {
    // 빈 양식은 머리줄 아래 값 줄이 하나뿐일 수 있다(「해당 없음」 한 줄).
    if (t.rows < 2) return false;
    const cols = headerCols(t);
    return findHeader(cols, ["연번"]) !== null && (findHeader(cols, ["요청내역"]) !== null || findHeader(cols, ["요청부서"]) !== null);
  });
  if (requestTable) {
    const cols = headerCols(requestTable);
    const col = (words: string[]) => findHeader(cols, words) ?? undefined;
    requests = {
      sec: requestTable.sec,
      tbl: requestTable.tbl,
      firstRow: 1,
      rows: requestTable.rows - 1,
      cols: { no: col(["연번"]), group: col(["구분"]), dept: col(["요청부서"]), address: col(["위치"]), text: col(["요청내역"]), doc: col(["문서번호"]) },
    };
  } else missing.push("정비요청 세부내역");

  // ── 자리 표
  const spots: SpotTable[] = [];
  for (const t of doc.tables) {
    const before = t.cells.find((c) => norm(c.text) === "전");
    const after = t.cells.find((c) => norm(c.text) === "후");
    const address = t.cells.find((c) => norm(c.text) === "위치");
    if (!before || !after || !address) continue;
    const valueRight = (words: string[]) => {
      const label = t.cells.find((c) => words.includes(norm(c.text)));
      const value = label ? rightOf(t, label) : null;
      return value ? ref(value) : null;
    };
    const beforeCell = belowOf(t, before);
    const afterCell = belowOf(t, after);
    spots.push({
      sec: t.sec,
      tbl: t.tbl,
      no: valueRight(["연번"]),
      address: valueRight(["위치"]),
      work: valueRight(["정비내역", "조치내역", "내역"]),
      doc: valueRight(["문서번호"]),
      before: beforeCell ? ref(beforeCell) : null,
      after: afterCell ? ref(afterCell) : null,
    });
  }
  if (spots.length === 0) missing.push("자리 표(전·후)");
  const firstShot = spots[0]?.before ? doc.tables[spots[0].tbl]?.cells.find((c) => c.row === spots[0].before!.row && c.col === spots[0].before!.col) : null;
  const photoRatio = firstShot && firstShot.height > 0 ? firstShot.width / firstShot.height : 1.16;

  const shapes: [number, number, number][] = doc.tables.map((t) => [t.rows, t.cols, t.width]);
  const labels = doc.tables
    .flatMap((t) => t.cells.filter((c) => c.row === 0))
    .map((c) => c.text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ shapes, labels: labels.map(norm) }))
    .digest("hex")
    .slice(0, 12);

  const grade: PeriodFormMap["grade"] =
    title && totals.requested && categoryCount >= 20 && spots.length > 0 ? "A" : categoryCount >= 20 ? "B" : "C";

  return {
    version: 1,
    fingerprint,
    grade,
    title,
    totals,
    categories,
    requests,
    spots,
    photoRatio: Math.round(photoRatio * 1000) / 1000,
    missing,
    labels,
    shapes,
  };
}
