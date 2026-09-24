import type { IljiSlots } from "../ilji-slots";
import { buildHeader, CHAR, Fills, PARA } from "./head";
import { packHwpx, type Binary } from "./package";
import { buildSection, paragraph, table, type Cell } from "./section";

/**
 * 기본 양식. 「현장 순찰 일지」.
 *
 *   1쪽   맨 위 띠(일지 이름 · 동) 아래에 **틀 하나**가 쪽을 통째로 두른다(선은 사진 표와 같은 얇은 선). 그 안에
 *         제목 두 줄(「현장 순찰 일지」 / 「동 · 부서」, 사이에 선) · 개요 네 칸 두 줄(일시·순찰자 / 지역·처리 개소) ·
 *         란마다 머리띠 한 칸(「□ 순찰사항 · 6개소」)과 본문: 순찰사항 · 계절특수 점검 · 위험시설물 점검 · 주민소통 · (특이사항은 적은 것이 있을 때만).
 *         본문 칸 높이는 **글 줄 수로 먼저 잡고**(줄이 넘쳐 칸이 자라 다음 쪽으로 밀리지 않게) 남는 높이를 무게대로 나눠
 *         첫 쪽이 꽉 차게 한다. 글이 한 쪽 몫을 넘으면 그때만 다음 쪽으로 이어진다.
 *   2쪽~  현장 사진. 자리마다 표 하나. 순찰사항은 정비 전 | 정비 후, 나머지 란은 「현장 확인」 한두 장.
 *
 * 어느 기관의 양식도 베끼지 않았다. 담기는 값은 슬롯 여덟과 사진뿐이라 어느 동이든 그대로 쓸 수 있고,
 * 본인 양식이 따로 있으면 그쪽에 채운다(부서 양식 브릿지). 상표·검증 표지는 넣지 않는다.
 * 결재에 올라가는 종이라 도구 이름이 있을 자리가 아니다.
 */

// 셀 크기는 정수(HWPUNIT). 나누어떨어지게 잡는다. 소수가 들어가면 한글이 표를 못 그린다.
const TABLE_WIDTH = 49150;
const LABEL_WIDTH = 7600;
const HALF_VALUE = (TABLE_WIDTH - LABEL_WIDTH * 2) / 2; // 16975
const COLS = [LABEL_WIDTH, HALF_VALUE, LABEL_WIDTH, HALF_VALUE];

/** 쪽에서 글이 들어갈 수 있는 높이. A4 84188 에서 위·아래 여백과 머리·꼬리 자리를 뺀 값. */
const PAGE_BODY = 72850;
const STRIP_HEIGHT = 1300;
/** 제목 두 줄. 「현장 순찰 일지」 와 「동 · 부서」 사이에 선이 간다. */
const TITLE_HEIGHT = 3000;
const SUBTITLE_HEIGHT = 1660;
const INFO_HEIGHT = 1480;
const BAR_HEIGHT = 1600;
/**
 * 문단 줄 높이·표 여백 몫으로 남겨 두는 값. 이만큼 비워야 첫 쪽이 넘치지 않는다.
 * 이 표는 글자처럼 놓인 표(treatAsChar)라 **쪽에 못 들어가면 통째로 다음 쪽으로 간다.** 그러면 1쪽에 띠 한 줄만
 * 남는다(09-24 실물). 그래서 표 높이는 넉넉히 모자라게 잡는다. 칸이 글보다 크면 빈 자리가 남을 뿐이다.
 */
const SLACK = 3200;
/** 본문 한 줄 높이. 12pt · 줄간격 150% 를 한글에서 재 보면 줄당 ≈1535(사용자 편집본 8줄 12280). 조금 위로. */
const LINE_HEIGHT = 1600;
const CELL_PAD = 280 + 300;
/** 본문 칸에서 글이 들어가는 너비. 표 너비에서 칸 여백과 문단 왼쪽 여백을 뺀 값. */
const TEXT_WIDTH = TABLE_WIDTH - 280 - 100;

const PHOTO_TABLE_WIDTH = 49040;
const PHOTO_WIDTH = PHOTO_TABLE_WIDTH / 2;
const PHOTO_HEIGHT = 15500;
const HEAD_HEIGHT = 1700;
const CAPTION_HEIGHT = 1600;

/** 사진 칸의 가로/세로. 브라우저가 이 비율로 잘라 보낸다. 안 맞으면 셀에 늘려 붙어 찌그러진다. */
export const PHOTO_RATIO = PHOTO_WIDTH / PHOTO_HEIGHT;

const SECTION_FILL = "#DFE6F7";
const LABEL_FILL = "#F2F2F2";

let nextId = 0;

export function buildIljiHwpx(slots: IljiSlots): Uint8Array {
  nextId = 0;
  const fills = new Fills();
  const dong = slots.dong.trim() || "○○동";
  const unit = slots.unit.trim();
  const blocks: string[] = [];
  const binaries: Binary[] = [];

  blocks.push(strip(fills, `■ 현장 순찰 일지 · ${dong}`, ""));
  blocks.push(page(fills, slots, dong, unit));

  // 사진 표가 쓰는 테두리를 먼저 등록해 둔다. 그림 채움은 등록된 벌 뒤에 붙으므로 그 뒤로는 새 벌이 없어야 한다.
  const thin = fills.id({ border: "thin" });
  const section = fills.id({ border: "thin", color: SECTION_FILL });
  const imageCount = fills.specs.length;

  if (slots.photos.length > 0) {
    blocks.push(paragraph({ text: "현장 사진", char: CHAR.heading, pageBreak: true }));
    slots.photos.forEach((photo, i) => {
      if (i > 0) blocks.push(paragraph({ text: "", char: CHAR.gap }));
      const shots: Cell[] = [photo.before, photo.after].map((bytes, side) => {
        let fill = thin;
        if (bytes) {
          const id = `img${binaries.length + 1}`;
          binaries.push({ id, path: `BinData/${id}.jpg`, bytes });
          fill = fills.imageId(binaries.length - 1);
        }
        return { row: 1, col: side, width: PHOTO_WIDTH, height: PHOTO_HEIGHT, lines: [], fill };
      });
      const head = `□ ${photo.caption}${photo.note ? `   ·   ${photo.note}` : ""}`;
      const captions: Cell[] = photo.pair
        ? ["정비 전", "정비 후"].map((text, side) => ({
            row: 2, col: side, width: PHOTO_WIDTH, height: CAPTION_HEIGHT, lines: [text], char: CHAR.caption, para: PARA.center,
          }))
        : [{ row: 2, col: 0, colSpan: 2, width: PHOTO_TABLE_WIDTH, height: CAPTION_HEIGHT, lines: ["현장 확인"], char: CHAR.caption, para: PARA.center }];
      blocks.push(
        table({
          id: tableId(),
          zOrder: nextId,
          rows: 3,
          cols: 2,
          width: PHOTO_TABLE_WIDTH,
          height: HEAD_HEIGHT + PHOTO_HEIGHT + CAPTION_HEIGHT,
          fill: thin,
          body: [
            [{ row: 0, col: 0, colSpan: 2, width: PHOTO_TABLE_WIDTH, height: HEAD_HEIGHT, lines: [head], fill: section, char: CHAR.section, para: PARA.cell }],
            shots,
            captions,
          ],
        }),
      );
    });
  }
  if (fills.specs.length !== imageCount) throw new Error("사진 표가 새 테두리를 등록했다. 그림 채움 번호가 밀린다.");

  const header = buildHeader(fills, binaries.map((b) => b.id));
  const sectionXml = buildSection(blocks);
  return packHwpx({ header, section: sectionXml, binaries, title: `${dong} 현장 순찰 일지` });
}

function tableId(): number {
  nextId += 1;
  return 1000000 + nextId;
}

/** 맨 위 띠. 왼쪽에 일지 이름. 선 없는 표 하나다. */
function strip(fills: Fills, left: string, right: string): string {
  const blank = fills.id({ border: "none" });
  const half = TABLE_WIDTH / 2; // 24575
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

/**
 * 첫 쪽 전체가 표 하나다. 제목 · 개요 · 란 다섯. 바깥 가장자리 셀은 그 쪽 변만 굵게 긋는다.
 * 그래서 한 틀이 쪽을 두르고, 표 사이 공백이 없다.
 */
function page(fills: Fills, slots: IljiSlots, dong: string, unit: string): string {
  const r = slots.rows;
  const c = slots.counts ?? {};
  // 특이사항 칸은 적은 것이 있을 때만. 빈 칸으로 1쪽 자리를 먹지 않는다(사용자 지시).
  const spec: [string, keyof typeof r, number][] = [
    ["□ 순찰사항", "patrol", 34],
    ["□ 계절특수 점검", "seasonal", 22],
    ["□ 위험시설물 점검", "facility", 22],
    ["□ 주민소통", "community", 10],
    ...(r.etc.length > 0 ? ([["□ 특이사항", "etc", 12]] as [string, keyof typeof r, number][]) : []),
  ];
  // 본문 칸 높이. 글 줄 수로 먼저 잡는다. 셀보다 글이 크면 한글이 셀을 늘려 첫 쪽이 다음 쪽으로 밀리기 때문이다.
  // 그러고 남는 높이를 무게대로 나눠 첫 쪽이 꽉 차게 한다. 글이 한 쪽 몫을 넘으면 그때는 어쩔 수 없이 넘긴다.
  const fixed = STRIP_HEIGHT + TITLE_HEIGHT + SUBTITLE_HEIGHT + INFO_HEIGHT * 2 + BAR_HEIGHT * spec.length + SLACK;
  const needed = spec.map(([, key]) => Math.max(1, estimateLines(r[key])) * LINE_HEIGHT + CELL_PAD);
  const free = Math.max(0, PAGE_BODY - fixed - needed.reduce((a, b) => a + b, 0));
  const weightSum = spec.reduce((sum, [, , w]) => sum + w, 0);
  const bodyHeights = spec.map(([, , w], i) => needed[i] + Math.floor((free * w) / weightSum / 10) * 10);

  const rowCount = 2 + 2 + spec.length * 2;
  /** 선은 전부 사진 표와 같은 얇은 선. 색만 다르다. */
  const edge = (color?: string): number => fills.id({ border: "thin", color });
  const label = (row: number, col: number, text: string): Cell => ({
    row, col, width: COLS[col], height: INFO_HEIGHT, lines: [text], fill: edge(LABEL_FILL), char: CHAR.label, para: PARA.center,
  });
  const value = (row: number, col: number, text: string, char: number = CHAR.body, para: number = PARA.cell): Cell => ({
    row, col, width: COLS[col], height: INFO_HEIGHT, lines: text ? [text] : [], fill: edge(), char, para,
  });

  const places = slots.photos.length;
  const shots = slots.photos.reduce((n, p) => n + (p.before ? 1 : 0) + (p.after ? 1 : 0), 0);
  const summary = places > 0 ? `${places}개소 · 사진 ${shots}장` : "";

  const body: Cell[][] = [
    [{ row: 0, col: 0, colSpan: 4, width: TABLE_WIDTH, height: TITLE_HEIGHT, lines: ["현장 순찰 일지"], fill: edge(), char: CHAR.title, para: PARA.center }],
    [{ row: 1, col: 0, colSpan: 4, width: TABLE_WIDTH, height: SUBTITLE_HEIGHT, lines: [unit ? `${dong} · ${unit}` : dong], fill: edge(), char: CHAR.subtitle, para: PARA.center }],
    [label(2, 0, "순찰일시"), value(2, 1, slots.dateLabel.trim()), label(2, 2, "순찰자"), value(2, 3, slots.officer.trim())],
    [label(3, 0, "순찰지역"), value(3, 1, slots.area.trim()), label(3, 2, "처리 개소"), value(3, 3, summary, CHAR.body, PARA.center)],
  ];
  let height = TITLE_HEIGHT + SUBTITLE_HEIGHT + INFO_HEIGHT * 2;
  spec.forEach(([title, key], i) => {
    const row = 4 + i * 2;
    const count = c[key];
    // 머리띠는 한 칸. 「□ 순찰사항 · 6개소」.
    const head = count === undefined ? title : `${title} · ${count}개소`;
    body.push([{ row, col: 0, colSpan: 4, width: TABLE_WIDTH, height: BAR_HEIGHT, lines: [head], fill: edge(SECTION_FILL), char: CHAR.section, para: PARA.cell }]);
    body.push([{ row: row + 1, col: 0, colSpan: 4, width: TABLE_WIDTH, height: bodyHeights[i], lines: r[key], fill: edge(), vertAlign: "TOP" }]);
    height += BAR_HEIGHT + bodyHeights[i];
  });

  return table({ id: tableId(), zOrder: nextId, rows: rowCount, cols: 4, width: TABLE_WIDTH, height, fill: fills.id({ border: "thin" }), body });
}

/**
 * 이 줄들이 칸에서 몇 줄을 차지하나. 한글·전각은 글자 크기만큼, 영문·숫자는 그 반으로 어림한다.
 * 정확할 필요는 없다. 모자라게 잡는 쪽만 피하면 된다(그러면 칸이 자라 첫 쪽이 넘친다).
 */
export function estimateLines(lines: string[]): number {
  let total = 0;
  for (const line of lines) {
    let width = 0;
    for (const ch of line) {
      const code = ch.codePointAt(0) ?? 0;
      width += code < 0x2000 ? (ch === " " ? 400 : 650) : 1200;
    }
    total += Math.max(1, Math.ceil(width / TEXT_WIDTH));
  }
  return total;
}
