import type { IljiPhoto } from "../ilji-slots";
import { laneLabel, type LaneOrUnknown } from "../lanes";
import { COUNT_KEYS, COUNT_LABELS, longDate, shortDate, type PeriodSummary } from "../period";
import { buildHeader, CHAR, Fills, PARA } from "./head";
import { estimateLines } from "./ilji";
import { packHwpx, type Binary } from "./package";
import { photoGap, photoTable } from "./photos";
import { buildSection, paragraph, table, type Cell } from "./section";

/**
 * 기본 양식. 「현장 순찰 결과 보고서」. 한 사람의 일지를 주 · 달로 모은 것.
 *
 *   1쪽    틀 하나. 제목 두 줄 · 개요(기간 · 순찰 일수 / 순찰자 · 처리 개소) · 「□ 추진 실적」(란별 개소와
 *          총계 · 기능부서 정비요청 · 동 자체정비) · 「□ 일자별 실적」 · 「□ 위험시설물 점검 내역」 ·
 *          (주민소통 · 특이사항은 적은 것이 있을 때만). 핵심만. 날이 많으면 셀 단위로 다음 쪽에 이어진다.
 *   2쪽    「1. 기능부서 정비요청 및 자체정비 추진 실적」. 결과 보고 양식의 항목표(구분 × 내용) 전부.
 *          사진으로 아는 줄만 숫자가 들어가고 **나머지는 빈 칸으로 보인다.** 0 과 빈 칸은 다른 뜻이다.
 *   3쪽    「2. 기능부서 정비요청 세부내역」. 일지의 말에 통보 · 신고 · 요청이 적힌 자리.
 *   4쪽~   「3. 동 자체 정비실적 세부내역 · 현장 사진」. 란별로 묶고 그 안에서 날짜 차례. 자리마다 표 하나.
 *
 * 한 파일에 다 담기고 쪽수 제한은 없다. 어느 기관의 양식도 베끼지 않았고 순위 · 평가 칸은 없다.
 * 결재에 올라가는 종이라 상표 · 도구 이름은 넣지 않는다.
 *
 * ⚠ 한 표 안에서 열 너비는 **한 격자**여야 한다. 첫 판은 라벨 줄(7600 | 16975 …)과 고른 줄(12290 × 4)을
 * 한 표에 섞었더니 한글 뷰어가 열을 넓게 잡아 오른쪽이 잘렸다(09-26 실물). 그래서 여섯 칸 격자를 두고
 * 두 꼴 다 그 격자의 병합으로 만든다.
 */

const TABLE_WIDTH = 49150;
/** 여섯 칸 격자. 라벨 줄 = [0] [1+2] [3] [4+5], 고른 줄 = [0+1] [2] [3+4] [5]. 합은 표 너비. */
const GRID = [7600, 4690, 12290, 7600, 4690, 12280];

const STRIP_HEIGHT = 1300;
const TITLE_HEIGHT = 3000;
const SUBTITLE_HEIGHT = 1660;
const INFO_HEIGHT = 1480;
const BAR_HEIGHT = 1600;
const ROW_HEIGHT = 1200;
const LINE_HEIGHT = 1600;
const CELL_PAD = 280 + 300;

const SECTION_FILL = "#DFE6F7";
const LABEL_FILL = "#F2F2F2";

/** 항목표 열. 구분 · 내용 · 정비요청 · 자체정비 · 비고. */
const CAT_COLS = [7410, 24465, 6100, 6105, 5070];
/** 정비요청 세부내역 열. 연번 · 구분 · 요청부서 · 위치 · 요청내역 · 문서번호. */
const REQ_COLS = [3305, 5955, 7085, 12335, 12430, 8040];

const LANE_ORDER: LaneOrUnknown[] = ["waste_cleanup", "flood_season", "risk_facility"];

export interface PeriodPhoto extends IljiPhoto {
  /** 자리의 날짜(YYYY-MM-DD). */
  date: string;
  lane: LaneOrUnknown;
  /** 세부내역 연번. */
  no: number;
  /** 정비내역(말). */
  work: string;
}

export interface PeriodSlots {
  dong: string;
  unit: string;
  officer: string;
  summary: PeriodSummary;
  photos: PeriodPhoto[];
}

let nextId = 0;

export function buildPeriodHwpx(slots: PeriodSlots): Uint8Array {
  nextId = 0;
  const fills = new Fills();
  const s = slots.summary;
  const dong = slots.dong.trim() || s.dong.trim() || "○○동";
  const unit = slots.unit.trim();
  const blocks: string[] = [];
  const binaries: Binary[] = [];

  blocks.push(strip(fills, `■ 현장 순찰 결과 보고 · ${dong}`, s.period.name));
  blocks.push(page(fills, slots, dong, unit));

  blocks.push(paragraph({ text: "1. 기능부서 정비요청 및 자체정비 추진 실적", char: CHAR.heading, pageBreak: true }));
  blocks.push(photoGap());
  blocks.push(categoryTable(fills, s));

  blocks.push(paragraph({ text: "2. 기능부서 정비요청 세부내역", char: CHAR.heading, pageBreak: true }));
  blocks.push(photoGap());
  blocks.push(requestTable(fills, s));
  blocks.push(paragraph({ text: "※ 요청부서와 문서번호는 담당자가 기재합니다.", char: CHAR.note }));

  // 사진 표가 쓰는 테두리를 먼저 등록해 둔다. 그림 채움은 등록된 벌 뒤에 붙으므로 그 뒤로는 새 벌이 없어야 한다.
  const thin = fills.id({ border: "thin" });
  const section = fills.id({ border: "thin", color: SECTION_FILL });
  const registered = fills.specs.length;

  blocks.push(paragraph({ text: "3. 동 자체 정비실적 세부내역 · 현장 사진", char: CHAR.heading, pageBreak: true }));
  if (slots.photos.length === 0) {
    blocks.push(paragraph({ text: "  ○ 실은 사진 없음", char: CHAR.body }));
  }
  let first = true;
  for (const lane of LANE_ORDER) {
    const mine = slots.photos.filter((photo) => photo.lane === lane).sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no);
    if (mine.length === 0) continue;
    if (!first) blocks.push(photoGap());
    first = false;
    blocks.push(paragraph({ text: `${laneLabel(lane)} · ${mine.length}건`, char: CHAR.heading }));
    mine.forEach((photo) => {
      blocks.push(photoGap());
      const head = `□ ${shortDate(photo.date)}   ${photo.caption}${photo.work ? `   ·   ${photo.work}` : ""}`;
      blocks.push(photoTable({ fills, binaries, thin, section, photo, head, id: tableId(), zOrder: nextId }));
    });
  }
  if (fills.specs.length !== registered) throw new Error("사진 표가 새 테두리를 등록했다. 그림 채움 번호가 밀린다.");

  const header = buildHeader(fills, binaries.map((b) => b.id));
  return packHwpx({ header, section: buildSection(blocks), binaries, title: `${dong} 현장 순찰 결과 보고서` });
}

function tableId(): number {
  nextId += 1;
  return 1000000 + nextId;
}

function strip(fills: Fills, left: string, right: string): string {
  const blank = fills.id({ border: "none" });
  const half = TABLE_WIDTH / 2;
  return table({
    id: tableId(),
    zOrder: nextId,
    rows: 1,
    cols: 2,
    width: TABLE_WIDTH,
    height: STRIP_HEIGHT,
    fill: blank,
    body: [[
      { row: 0, col: 0, width: half, height: STRIP_HEIGHT, lines: [left], fill: blank, char: CHAR.strip, para: PARA.left },
      { row: 0, col: 1, width: half, height: STRIP_HEIGHT, lines: [right], fill: blank, char: CHAR.strip, para: PARA.right },
    ]],
  });
}

function sum(widths: number[], from: number, span: number): number {
  return widths.slice(from, from + span).reduce((a, b) => a + b, 0);
}

/** 1쪽. 여섯 칸 격자 위의 틀 하나. */
function page(fills: Fills, slots: PeriodSlots, dong: string, unit: string): string {
  const s = slots.summary;
  const edge = (color?: string): number => fills.id({ border: "thin", color });
  const body: Cell[][] = [];
  let row = 0;
  let height = 0;

  const at = (col: number, span: number, text: string, h: number, opts: { label?: boolean; center?: boolean; color?: string; char?: number } = {}): Cell => ({
    row,
    col,
    colSpan: span,
    width: sum(GRID, col, span),
    height: h,
    lines: text ? [text] : [],
    fill: edge(opts.color ?? (opts.label ? LABEL_FILL : undefined)),
    char: opts.char ?? (opts.label ? CHAR.label : CHAR.body),
    para: opts.center || opts.label ? PARA.center : PARA.cell,
  });
  const push = (cells: Cell[], h: number) => {
    body.push(cells);
    row += 1;
    height += h;
  };
  const wide = (text: string, h: number, char: number, color?: string) =>
    push([at(0, 6, text, h, { center: true, char, color })], h);
  const bar = (text: string) =>
    push([{ row, col: 0, colSpan: 6, width: TABLE_WIDTH, height: BAR_HEIGHT, lines: [text], fill: edge(SECTION_FILL), char: CHAR.section, para: PARA.cell }], BAR_HEIGHT);
  /** 라벨 줄. [0] 라벨 [1+2] 값 [3] 라벨 [4+5] 값. */
  const labelRow = (a: string, av: string, b: string, bv: string, bvCenter = true) =>
    push([at(0, 1, a, INFO_HEIGHT, { label: true }), at(1, 2, av, INFO_HEIGHT), at(3, 1, b, INFO_HEIGHT, { label: true }), at(4, 2, bv, INFO_HEIGHT, { center: bvCenter })], INFO_HEIGHT);
  /** 고른 줄. [0+1] [2] [3+4] [5]. */
  const evenRow = (texts: [string, string, string, string], label: boolean) =>
    push(
      [at(0, 2, texts[0], ROW_HEIGHT, { label, center: true }), at(2, 1, texts[1], ROW_HEIGHT, { label, center: true }), at(3, 2, texts[2], ROW_HEIGHT, { label, center: true }), at(5, 1, texts[3], ROW_HEIGHT, { label, center: true })],
      ROW_HEIGHT,
    );
  const lines = (list: string[]) => {
    const h = Math.max(1, estimateLines(list)) * LINE_HEIGHT + CELL_PAD;
    body.push([{ row, col: 0, colSpan: 6, width: TABLE_WIDTH, height: h, lines: list, fill: edge(), vertAlign: "TOP" }]);
    row += 1;
    height += h;
  };

  wide("현장 순찰 결과 보고서", TITLE_HEIGHT, CHAR.title);
  wide([dong, unit].filter(Boolean).join(" · "), SUBTITLE_HEIGHT, CHAR.subtitle);
  labelRow(
    "기간",
    `${longDate(s.period.from)} ~ ${s.period.from.slice(0, 4) === s.period.to.slice(0, 4) ? shortDate(s.period.to) : longDate(s.period.to)}`,
    "순찰 일수",
    `${s.days}일`,
  );
  labelRow("순찰자", slots.officer.trim(), "처리 개소", s.places > 0 ? `${s.places}개소${s.shots > 0 ? ` · 사진 ${s.shots}장` : ""}` : "");

  bar("□ 추진 실적");
  evenRow(["구분", COUNT_LABELS.patrol, COUNT_LABELS.seasonal, COUNT_LABELS.facility], true);
  evenRow(["개소", `${s.counts.patrol}`, `${s.counts.seasonal}`, `${s.counts.facility}`], false);
  evenRow(["총계", "기능부서 정비요청", "동 자체정비", "비고"], true);
  evenRow([`${s.requested + s.self}`, `${s.requested}`, `${s.self}`, ""], false);

  bar(`□ 일자별 실적 · ${s.days}일`);
  evenRow(["일자", COUNT_LABELS.patrol, COUNT_LABELS.seasonal, COUNT_LABELS.facility], true);
  if (s.lines.length === 0) wide("해당 없음", ROW_HEIGHT, CHAR.body);
  for (const line of s.lines) {
    evenRow([shortDate(line.date), ...COUNT_KEYS.map((key) => (line.legacy ? "-" : `${line.counts[key]}`)) as [string, string, string]], false);
  }

  bar(`□ 위험시설물 점검 내역 · ${s.facilities.length}건`);
  lines(
    s.facilities.length === 0
      ? ["○ 해당 없음"]
      : s.facilities.flatMap((f) => [
          `○ ${shortDate(f.date)} ${f.address} ${f.parts[0]}`,
          ...(f.parts[1] ? [`  ※ ${f.parts[1]}`] : []),
          ...f.parts.slice(2).map((rest) => `  → ${rest}`),
        ]),
  );

  if (s.community.length > 0) {
    bar(`□ 주민소통 · ${s.community.length}건`);
    lines(s.community.map((c) => `○ ${shortDate(c.date)} ${c.text}`));
  }
  if (s.etc.length > 0) {
    bar(`□ 특이사항 · ${s.etc.length}건`);
    lines(s.etc.map((e) => `○ ${shortDate(e.date)} ${e.text}`));
  }

  return table({ id: tableId(), zOrder: nextId, rows: row, cols: 6, width: TABLE_WIDTH, height, fill: fills.id({ border: "thin" }), body });
}

/** 2쪽. 항목표. 구분 칸은 같은 구분이 이어지는 만큼 세로 병합. 셀 수 없는 줄은 빈 칸. */
function categoryTable(fills: Fills, s: PeriodSummary): string {
  const edge = (color?: string): number => fills.id({ border: "thin", color });
  const cellAt = (row: number, col: number, text: string, opts: { label?: boolean; center?: boolean; rowSpan?: number; colSpan?: number } = {}): Cell => ({
    row,
    col,
    rowSpan: opts.rowSpan,
    colSpan: opts.colSpan,
    width: sum(CAT_COLS, col, opts.colSpan ?? 1),
    height: ROW_HEIGHT,
    lines: text ? [text] : [],
    fill: edge(opts.label ? LABEL_FILL : undefined),
    char: opts.label ? CHAR.label : CHAR.body,
    para: opts.center || opts.label ? PARA.center : PARA.cell,
  });
  const body: Cell[][] = [];
  body.push(["구분", "내용", "정비요청", "자체정비", "비고"].map((text, col) => cellAt(0, col, text, { label: true })));

  let row = 1;
  for (let i = 0; i < s.categories.length; i++) {
    const line = s.categories[i];
    const cells: Cell[] = [];
    if (i === 0 || s.categories[i - 1].group !== line.group) {
      let span = 1;
      while (i + span < s.categories.length && s.categories[i + span].group === line.group) span += 1;
      cells.push(cellAt(row, 0, line.group, { label: true, rowSpan: span }));
    }
    cells.push(cellAt(row, 1, `∘ ${line.item}`));
    cells.push(cellAt(row, 2, line.requested === null ? "" : `${line.requested}`, { center: true }));
    cells.push(cellAt(row, 3, line.self === null ? "" : `${line.self}`, { center: true }));
    cells.push(cellAt(row, 4, ""));
    body.push(cells);
    row += 1;
  }
  body.push([
    cellAt(row, 0, "합계", { label: true, colSpan: 2 }),
    cellAt(row, 2, `${s.requested}`, { center: true }),
    cellAt(row, 3, `${s.self}`, { center: true }),
    cellAt(row, 4, ""),
  ]);
  row += 1;

  return table({ id: tableId(), zOrder: nextId, rows: row, cols: 5, width: TABLE_WIDTH, height: row * ROW_HEIGHT, fill: fills.id({ border: "thin" }), body });
}

/** 3쪽. 정비요청 세부내역. 없으면 한 줄 「해당 없음」. */
function requestTable(fills: Fills, s: PeriodSummary): string {
  const edge = (color?: string): number => fills.id({ border: "thin", color });
  const heightFor = (texts: string[]): number =>
    Math.max(1, ...texts.map((text, col) => estimateLines([text], REQ_COLS[col] - 500))) * LINE_HEIGHT + CELL_PAD - 300;
  const rowOf = (row: number, texts: string[], label: boolean, h: number): Cell[] =>
    texts.map((text, col) => ({
      row,
      col,
      width: REQ_COLS[col],
      height: h,
      lines: text ? [text] : [],
      fill: edge(label ? LABEL_FILL : undefined),
      char: label ? CHAR.label : CHAR.body,
      para: label || col === 0 || col === 1 ? PARA.center : PARA.cell,
    }));
  const body: Cell[][] = [];
  let height = 0;
  const push = (cells: Cell[], h: number) => {
    body.push(cells);
    height += h;
  };
  push(rowOf(0, ["연번", "구분", "요청부서", "위치", "요청내역", "문서번호"], true, ROW_HEIGHT), ROW_HEIGHT);
  if (s.requests.length === 0) {
    push([{ row: 1, col: 0, colSpan: 6, width: TABLE_WIDTH, height: ROW_HEIGHT, lines: ["해당 없음"], fill: edge(), para: PARA.center }], ROW_HEIGHT);
  }
  s.requests.forEach((r, i) => {
    const texts = [`${r.no}`, r.group, "", `${shortDate(r.date)} ${r.address}`, r.text, ""];
    const h = heightFor(texts);
    push(rowOf(i + 1, texts, false, h), h);
  });
  return table({ id: tableId(), zOrder: nextId, rows: body.length, cols: 6, width: TABLE_WIDTH, height, fill: fills.id({ border: "thin" }), body });
}
