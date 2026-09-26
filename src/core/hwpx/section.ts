import { CHAR, FILL, PARA } from "./head";
import { A4, BODY_WIDTH, NAMESPACES, XML_HEAD, esc, tag } from "./xml";

/**
 * section0.xml 의 조각들. 문단·표·셀.
 *
 * 줄 배치 캐시(`hp:linesegarray`)는 **적지 않는다.** 한글이 열 때 스스로 만든다.
 * 적어 두면 내용과 어긋난 캐시가 되고, 그러면 한글은 파일을 열지 않는다.
 */

export interface Para {
  text: string;
  char?: number;
  para?: number;
  /** 이 문단부터 새 쪽. */
  pageBreak?: boolean;
}

/** 문단 하나. 글이 비면 빈 run 하나(한글은 빈 문단도 run 을 요구한다). */
export function paragraph({ text, char = CHAR.body, para = PARA.left, pageBreak = false }: Para): string {
  const run = text ? tag("hp:run", { charPrIDRef: char }, `<hp:t>${esc(text)}</hp:t>`) : tag("hp:run", { charPrIDRef: char });
  return tag(
    "hp:p",
    { id: 0, paraPrIDRef: para, styleIDRef: 0, pageBreak: pageBreak ? 1 : 0, columnBreak: 0, merged: 0 },
    run,
  );
}

export interface Cell {
  row: number;
  col: number;
  width: number;
  height: number;
  /** 줄마다 문단 하나. 빈 배열이면 빈 셀. */
  lines: string[];
  colSpan?: number;
  rowSpan?: number;
  fill?: number;
  char?: number;
  para?: number;
  /** 셀 안 세로 정렬. 사진 설명·라벨은 가운데, 본문은 위. */
  vertAlign?: "TOP" | "CENTER";
  /** 줄마다 모양이 다를 때(제목 상자). 주면 `lines` 대신 이것을 쓴다. */
  paras?: Para[];
}

export function cell(c: Cell, defaultFill: number): string {
  const char = c.char ?? CHAR.body;
  const para = c.para ?? PARA.cell;
  const paras = c.paras
    ? c.paras.map(paragraph).join("")
    : c.lines.length === 0
      ? paragraph({ text: "", char, para })
      : c.lines.map((line) => paragraph({ text: line, char, para })).join("");
  return tag(
    "hp:tc",
    { name: "", header: 0, hasMargin: 0, protect: 0, editable: 0, dirty: 0, borderFillIDRef: c.fill ?? defaultFill },
    tag(
      "hp:subList",
      {
        id: "",
        textDirection: "HORIZONTAL",
        lineWrap: "BREAK",
        vertAlign: c.vertAlign ?? "CENTER",
        linkListIDRef: 0,
        linkListNextIDRef: 0,
        textWidth: 0,
        textHeight: 0,
        hasTextRef: 0,
        hasNumRef: 0,
      },
      paras,
    ) +
      tag("hp:cellAddr", { colAddr: c.col, rowAddr: c.row }) +
      tag("hp:cellSpan", { colSpan: c.colSpan ?? 1, rowSpan: c.rowSpan ?? 1 }) +
      tag("hp:cellSz", { width: c.width, height: c.height }) +
      tag("hp:cellMargin", { left: 140, right: 140, top: 140, bottom: 140 }),
  );
}

export interface Table {
  id: number;
  zOrder: number;
  rows: number;
  cols: number;
  width: number;
  height: number;
  /** 행마다 셀 목록. 병합으로 덮인 자리는 적지 않는다. */
  body: Cell[][];
  /** 표를 품은 문단의 정렬. 오른쪽에 붙이는 결재란에 쓴다. */
  para?: number;
  /** 이 표부터 새 쪽. 주간 일지가 날마다 새 쪽에서 시작할 때 쓴다. */
  pageBreak?: boolean;
  /** 표 테두리이자 셀의 기본 테두리(`Fills` 로 얻은 번호). */
  fill: number;
}

/** 표 하나를 품은 문단. 표는 글자처럼 줄에 놓인다(treatAsChar). */
export function table(t: Table): string {
  const rows = t.body.map((cells) => tag("hp:tr", {}, cells.map((c) => cell(c, t.fill)).join(""))).join("");
  const tbl = tag(
    "hp:tbl",
    {
      id: t.id,
      zOrder: t.zOrder,
      numberingType: "TABLE",
      textWrap: "TOP_AND_BOTTOM",
      textFlow: "BOTH_SIDES",
      lock: 0,
      dropcapstyle: "None",
      // 쪽이 넘치면 셀 단위로 나뉜다. 한 표를 통째로 다음 쪽에 미는 것보다 낫다.
      pageBreak: "CELL",
      repeatHeader: 0,
      rowCnt: t.rows,
      colCnt: t.cols,
      cellSpacing: 0,
      borderFillIDRef: t.fill,
      noAdjust: 0,
    },
    tag("hp:sz", { width: t.width, widthRelTo: "ABSOLUTE", height: t.height, heightRelTo: "ABSOLUTE", protect: 0 }) +
      tag("hp:pos", {
        treatAsChar: 1,
        affectLSpacing: 0,
        flowWithText: 0,
        allowOverlap: 0,
        holdAnchorAndSO: 0,
        vertRelTo: "PARA",
        horzRelTo: "COLUMN",
        vertAlign: "TOP",
        horzAlign: "LEFT",
        vertOffset: 0,
        horzOffset: 0,
      }) +
      tag("hp:outMargin", { left: 140, right: 140, top: 140, bottom: 140 }) +
      tag("hp:inMargin", { left: 140, right: 140, top: 140, bottom: 140 }) +
      rows,
  );
  return tag(
    "hp:p",
    { id: 0, paraPrIDRef: t.para ?? PARA.left, styleIDRef: 0, pageBreak: t.pageBreak ? 1 : 0, columnBreak: 0, merged: 0 },
    tag("hp:run", { charPrIDRef: CHAR.body }, tbl) + tag("hp:run", { charPrIDRef: CHAR.body }, "<hp:t/>"),
  );
}

/**
 * 구역 머리. 쪽 크기·여백·각주 설정. A4 세로, 여백은 한글 기본값과 같다.
 * 첫 문단의 첫 run 에 들어간다.
 */
function sectionHead(): string {
  const note = (length: number, between: number, below: number, above: number, place: string) =>
    tag("hp:autoNumFormat", { type: "DIGIT", userChar: "", prefixChar: "", suffixChar: ")", supscript: 0 }) +
    tag("hp:noteLine", { length, type: "SOLID", width: "0.12 mm", color: "#000000" }) +
    tag("hp:noteSpacing", { betweenNotes: between, belowLine: below, aboveLine: above }) +
    tag("hp:numbering", { type: "CONTINUOUS", newNum: 1 }) +
    tag("hp:placement", { place, beneathText: 0 });
  const pageBorder = (type: string, offset: number) =>
    tag(
      "hp:pageBorderFill",
      { type, borderFillIDRef: FILL.none, textBorder: "PAPER", headerInside: 0, footerInside: 0, fillArea: "PAPER" },
      tag("hp:offset", { left: offset, right: offset, top: offset, bottom: offset }),
    );
  return tag(
    "hp:secPr",
    {
      id: "",
      textDirection: "HORIZONTAL",
      spaceColumns: 1135,
      tabStop: 8000,
      tabStopVal: 4000,
      tabStopUnit: "HWPUNIT",
      outlineShapeIDRef: 0,
      memoShapeIDRef: 0,
      textVerticalWidthHead: 0,
      masterPageCnt: 0,
    },
    tag("hp:grid", { lineGrid: 0, charGrid: 0, wonggojiFormat: 0 }) +
      tag("hp:startNum", { pageStartsOn: "BOTH", page: 0, pic: 0, tbl: 0, equation: 0 }) +
      tag("hp:visibility", {
        hideFirstHeader: 0,
        hideFirstFooter: 0,
        hideFirstMasterPage: 0,
        border: "SHOW_ALL",
        fill: "SHOW_ALL",
        hideFirstPageNum: 0,
        hideFirstEmptyLine: 0,
        showLineNumber: 0,
      }) +
      tag("hp:lineNumberShape", { restartType: 0, countBy: 0, distance: 0, startNumber: 0 }) +
      tag(
        "hp:pagePr",
        { landscape: "WIDELY", width: A4.width, height: A4.height, gutterType: "LEFT_ONLY" },
        tag("hp:margin", { header: 2835, footer: 2835, gutter: 0, left: 5102, right: 5102, top: 2834, bottom: 2834 }),
      ) +
      tag("hp:footNotePr", {}, note(-1, 285, 570, 850, "EACH_COLUMN")) +
      tag("hp:endNotePr", {}, note(0, 0, 575, 865, "END_OF_DOCUMENT")) +
      pageBorder("BOTH", 1415) +
      pageBorder("EVEN", 1417) +
      pageBorder("ODD", 1417),
  );
}

/** section0.xml 전체. `blocks` 는 문단·표 XML 조각을 차례대로. */
export function buildSection(blocks: string[]): string {
  const first = tag(
    "hp:p",
    { id: 0, paraPrIDRef: PARA.left, styleIDRef: 0, pageBreak: 0, columnBreak: 0, merged: 0 },
    tag(
      "hp:run",
      { charPrIDRef: CHAR.body },
      sectionHead() +
        tag(
          "hp:ctrl",
          {},
          tag(
            "hp:colPr",
            { id: "", type: "NEWSPAPER", layout: "LEFT", colCount: 1, sameSz: 1, sameGap: 0 },
            tag("hp:colLine", { type: "NONE", width: "0.1 mm", color: "none" }),
          ),
        ) +
        "<hp:t/>",
    ),
  );
  return XML_HEAD + `<hs:sec${NAMESPACES}>` + first + blocks.join("") + "</hs:sec>";
}

export { BODY_WIDTH };
