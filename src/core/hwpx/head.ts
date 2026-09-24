import { NAMESPACES, XML_HEAD, tag } from "./xml";

/**
 * header.xml. 글꼴·테두리·글자 모양·문단 모양의 목록이다. 본문(section)은 여기 번호를 가리킨다.
 *
 * **번호는 목록마다 0(테두리는 1)부터 빈틈없이 잇는다.** 한글 뷰어 가운데 id 를 배열 자리로 읽는
 * 것이 있어, 번호가 한 칸 비면 그 뒤 스타일이 전부 한 칸씩 밀린다. 그래서 스타일은 아래
 * 상수 표로 못박고, 사진 테두리(그림 채움)만 그 뒤에 이어 붙인다.
 */

/** 글자 모양 번호. 본문이 이 이름으로 가리킨다. */
export const CHAR = {
  body: 0, // 본문 12pt
  title: 1, // 제목 22pt 헤드라인 굵게
  subtitle: 2, // 부제 13pt
  section: 3, // 표 안 머리띠 13pt 굵게 남색
  label: 4, // 표 라벨 12pt 굵게
  caption: 5, // 사진 설명 10pt
  heading: 6, // 「1. 순찰 개요」 13pt 굵게
  gap: 7, // 표 사이 빈 줄 5pt
  note: 8, // ※ 안내 9pt 회색
  big: 9, // 개소 수 같은 큰 숫자 14pt 굵게
  strip: 10, // 맨 위 띠 9pt 회색
} as const;

/** 문단 모양 번호. */
export const PARA = {
  left: 0, // 양쪽 맞춤, 160%
  center: 1, // 가운데, 140%
  cell: 2, // 표 안 본문, 왼쪽 여백 100, 150%
  right: 3, // 오른쪽 맞춤
} as const;

/** 고정 테두리 번호. 1부터다(한글이 그렇게 저장한다). 나머지는 `Fills` 가 3부터 이어 붙인다. */
export const FILL = {
  none: 1, // 문단 테두리용, 선 없음
  char: 2, // 글자 모양이 가리키는 빈 값
} as const;
const FILL_DYNAMIC_FROM = 3;

export type Edge = "left" | "right" | "top" | "bottom";

/** 테두리 한 벌. 선 종류 · 채움색 · 굵게 그을 가장자리. */
export interface FillSpec {
  border: "none" | "thin";
  color?: string;
  thick?: Edge[];
}

/**
 * 테두리 등록부. 같은 벌은 같은 번호. 번호는 3부터 빈틈없이 이어진다.
 * 한 쪽을 통째로 두르는 굵은 틀은 가장자리 셀마다 굵은 변이 달라서, 벌이 몇 개가 될지 미리 모른다.
 */
export class Fills {
  readonly specs: FillSpec[] = [];

  id(spec: FillSpec): number {
    const key = JSON.stringify({ b: spec.border, c: spec.color ?? "", t: [...(spec.thick ?? [])].sort() });
    const at = this.specs.findIndex((s) => JSON.stringify({ b: s.border, c: s.color ?? "", t: [...(s.thick ?? [])].sort() }) === key);
    if (at >= 0) return FILL_DYNAMIC_FROM + at;
    this.specs.push({ border: spec.border, color: spec.color, thick: spec.thick ? [...spec.thick] : undefined });
    return FILL_DYNAMIC_FROM + this.specs.length - 1;
  }

  /** 사진 테두리(그림 채움)는 등록된 벌 뒤에 이어 붙는다. i 번째 사진의 번호. */
  imageId(i: number): number {
    return FILL_DYNAMIC_FROM + this.specs.length + i;
  }
}

/** 옅은 파랑. 구역 머리글 칸의 색. */
export const SECTION_FILL = "#DFE6F7";
export const LABEL_FILL = "#F2F2F2";
/** 구역 머리글 글자색(남색). */
const SECTION_INK = "#1F3864";

const FONTS = ["함초롬돋움", "맑은 고딕", "HY헤드라인M", "휴먼명조", "함초롬바탕"] as const;
const FONT = { gothic: 1, headline: 2, myeongjo: 3 } as const;

const LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"] as const;

function fontfaces(): string {
  const fonts = FONTS.map((face, id) =>
    tag(
      "hh:font",
      { id, face, type: "TTF", isEmbedded: 0 },
      tag("hh:typeInfo", {
        familyType: "FCAT_GOTHIC",
        weight: 5,
        proportion: 3,
        contrast: 2,
        strokeVariation: 0,
        armStyle: 0,
        letterform: 2,
        midline: 0,
        xHeight: 4,
      }),
    ),
  ).join("");
  const faces = LANGS.map((lang) => tag("hh:fontface", { lang, fontCnt: FONTS.length }, fonts)).join("");
  return tag("hh:fontfaces", { itemCnt: LANGS.length }, faces);
}

const NOTE_INK = "#595959";

const THIN = "0.12 mm";
const THICK = "0.5 mm";

function border(type: "NONE" | "SOLID", thick: Edge[] = []): string {
  return (["left", "right", "top", "bottom"] as Edge[])
    .map((side) =>
      tag(`hh:${side}Border`, { type, width: type === "NONE" ? "0.1 mm" : thick.includes(side) ? THICK : THIN, color: "#000000" }),
    )
    .join("");
}

/** 테두리 하나. `fill` 은 채움 XML(색 또는 그림) 또는 빈 문자열. */
function borderFill(id: number, kind: "none" | "thin", fill = "", thick: Edge[] = []): string {
  const lines = kind === "none" ? border("NONE") : border("SOLID", thick);
  return tag(
    "hh:borderFill",
    { id, threeD: 0, shadow: 0, centerLine: "NONE", breakCellSeparateLine: 0 },
    tag("hh:slash", { type: "NONE", Crooked: 0, isCounter: 0 }) +
      tag("hh:backSlash", { type: "NONE", Crooked: 0, isCounter: 0 }) +
      lines +
      tag("hh:diagonal", { type: "NONE", width: "0.1 mm", color: "none" }) +
      (fill ? tag("hc:fillBrush", {}, fill) : ""),
  );
}

function colorFill(color: string): string {
  return tag("hc:winBrush", { faceColor: color, hatchColor: "#FF000000", alpha: 0 });
}

/** 셀 배경 그림. 사진은 이 길로 들어간다. 셀 크기에 맞춰 늘려 채운다(mode TOTAL). */
function imageFill(binaryId: string): string {
  return tag(
    "hc:imgBrush",
    { mode: "TOTAL" },
    tag("hc:img", { binaryItemIDRef: binaryId, bright: 0, contrast: 0, effect: "REAL_PIC", alpha: 0 }),
  );
}

function charPr(id: number, height: number, font: number, options: { bold?: boolean; color?: string } = {}): string {
  const seven = (value: number | string) =>
    Object.fromEntries(["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"].map((k) => [k, value]));
  return tag(
    "hh:charPr",
    {
      id,
      height,
      textColor: options.color ?? "#000000",
      shadeColor: "none",
      useFontSpace: 0,
      useKerning: 0,
      symMark: "NONE",
      borderFillIDRef: FILL.char,
    },
    tag("hh:fontRef", seven(font)) +
      tag("hh:ratio", seven(100)) +
      tag("hh:spacing", seven(0)) +
      tag("hh:relSz", seven(100)) +
      tag("hh:offset", seven(0)) +
      (options.bold ? "<hh:bold/>" : "") +
      tag("hh:underline", { type: "NONE", shape: "SOLID", color: "#000000" }) +
      tag("hh:strikeout", { shape: "NONE", color: "#000000" }) +
      tag("hh:outline", { type: "NONE" }) +
      tag("hh:shadow", { type: "NONE", color: "#B2B2B2", offsetX: 10, offsetY: 10 }),
  );
}

function paraPr(id: number, align: "JUSTIFY" | "CENTER" | "LEFT" | "RIGHT", spacing: number, left = 0): string {
  const margin =
    tag("hh:margin", {}, ["intent", "left", "right", "prev", "next"]
      .map((side) => tag(`hc:${side}`, { value: side === "left" ? left : 0, unit: "HWPUNIT" }))
      .join("")) + tag("hh:lineSpacing", { type: "PERCENT", value: spacing, unit: "HWPUNIT" });
  return tag(
    "hh:paraPr",
    { id, tabPrIDRef: 0, condense: 0, fontLineHeight: 0, snapToGrid: 1, suppressLineNumbers: 0, checked: 0 },
    tag("hh:align", { horizontal: align, vertical: "BASELINE" }) +
      tag("hh:heading", { type: "NONE", idRef: 0, level: 0 }) +
      tag("hh:breakSetting", {
        breakLatinWord: "KEEP_WORD",
        breakNonLatinWord: "BREAK_WORD",
        widowOrphan: 0,
        keepWithNext: 0,
        keepLines: 0,
        pageBreakBefore: 0,
        lineWrap: "BREAK",
      }) +
      tag("hh:autoSpacing", { eAsianEng: 0, eAsianNum: 0 }) +
      // 한글 2016 이후 판과 그 전 판이 여백을 다른 자리에서 읽는다. 둘 다 적는다.
      `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">${margin}</hp:case><hp:default>${margin}</hp:default></hp:switch>` +
      tag("hh:border", {
        borderFillIDRef: FILL.none,
        offsetLeft: 0,
        offsetRight: 0,
        offsetTop: 0,
        offsetBottom: 0,
        connect: 0,
        ignoreMargin: 0,
      }),
  );
}

/**
 * header.xml 전체. `fills` 는 본문이 등록한 테두리 벌, `imageIds` 는 사진마다 하나씩
 * (본문의 `binaryItemIDRef` 와 같은 값). i 번째 사진의 테두리 번호는 `fills.imageId(i)` 다.
 */
export function buildHeader(fills: Fills, imageIds: string[]): string {
  const list = [
    borderFill(FILL.none, "none"),
    borderFill(FILL.char, "none"),
    ...fills.specs.map((spec, i) =>
      borderFill(FILL_DYNAMIC_FROM + i, spec.border, spec.color ? colorFill(spec.color) : "", spec.thick ?? []),
    ),
    ...imageIds.map((id, i) => borderFill(fills.imageId(i), "thin", imageFill(id))),
  ];
  const chars = [
    charPr(CHAR.body, 1200, FONT.gothic),
    charPr(CHAR.title, 2200, FONT.headline, { bold: true }),
    charPr(CHAR.subtitle, 1300, FONT.gothic),
    charPr(CHAR.section, 1300, FONT.gothic, { bold: true, color: SECTION_INK }),
    charPr(CHAR.label, 1200, FONT.gothic, { bold: true }),
    charPr(CHAR.caption, 1000, FONT.myeongjo),
    charPr(CHAR.heading, 1300, FONT.gothic, { bold: true }),
    charPr(CHAR.gap, 500, FONT.gothic),
    charPr(CHAR.note, 900, FONT.gothic, { color: NOTE_INK }),
    charPr(CHAR.big, 1400, FONT.gothic, { bold: true }),
    charPr(CHAR.strip, 900, FONT.gothic, { color: NOTE_INK }),
  ];
  const paras = [
    paraPr(PARA.left, "JUSTIFY", 160),
    paraPr(PARA.center, "CENTER", 140),
    paraPr(PARA.cell, "LEFT", 150, 100),
    paraPr(PARA.right, "RIGHT", 140),
  ];

  return (
    XML_HEAD +
    `<hh:head${NAMESPACES} version="1.4" secCnt="1">` +
    tag("hh:beginNum", { page: 1, footnote: 1, endnote: 1, pic: 1, tbl: 1, equation: 1 }) +
    "<hh:refList>" +
    fontfaces() +
    tag("hh:borderFills", { itemCnt: list.length }, list.join("")) +
    tag("hh:charProperties", { itemCnt: chars.length }, chars.join("")) +
    tag("hh:tabProperties", { itemCnt: 1 }, tag("hh:tabPr", { id: 0, autoTabLeft: 0, autoTabRight: 0 })) +
    '<hh:numberings itemCnt="0"/>' +
    '<hh:bullets itemCnt="0"/>' +
    tag("hh:paraProperties", { itemCnt: paras.length }, paras.join("")) +
    tag(
      "hh:styles",
      { itemCnt: 1 },
      tag("hh:style", {
        id: 0,
        type: "PARA",
        name: "바탕글",
        engName: "Normal",
        paraPrIDRef: PARA.left,
        charPrIDRef: CHAR.body,
        nextStyleIDRef: 0,
        langID: 1042,
        lockForm: 0,
      }),
    ) +
    "</hh:refList>" +
    '<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>' +
    '<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption>' +
    '<hh:trackchageConfig flags="56"/>' +
    "</hh:head>"
  );
}
