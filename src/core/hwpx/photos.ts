import type { IljiPhoto } from "../ilji-slots";
import { CHAR, Fills, PARA } from "./head";
import type { Binary } from "./package";
import { paragraph, table, type Cell } from "./section";

/**
 * 현장 사진 표 한 자리. 일지(하루)와 결과 보고(기간)가 같은 표를 쓴다.
 *
 *   머리   「□ 주소 · 란」 (기간 보고는 앞에 날짜)
 *   사진   정비 전 | 정비 후  (짝이 아니면 그냥 두 칸)
 *   설명   「정비 전」「정비 후」 또는 「현장 확인」 한 칸
 *
 * 사진은 셀 배경(그림 채움)으로 들어간다. 배경은 셀 크기에 늘어나므로 브라우저가 `PHOTO_RATIO` 로 미리 잘라 보낸다.
 * 그림 채움 번호는 등록된 테두리 벌 뒤에 붙으므로, **이 함수를 부르기 전에** 표가 쓸 테두리(얇은 선·머리띠 색)를
 * 다 등록해 두어야 한다. 부르는 쪽이 `thin` 과 `section` 을 만들어 넘기는 까닭이다.
 */

export const PHOTO_TABLE_WIDTH = 49040;
export const PHOTO_WIDTH = PHOTO_TABLE_WIDTH / 2;
export const PHOTO_HEIGHT = 15500;
export const HEAD_HEIGHT = 1700;
export const CAPTION_HEIGHT = 1600;

/** 사진 칸의 가로/세로. 브라우저가 이 비율로 잘라 보낸다. 안 맞으면 셀에 늘려 붙어 찌그러진다. */
export const PHOTO_RATIO = PHOTO_WIDTH / PHOTO_HEIGHT;

export interface PhotoTableInput {
  fills: Fills;
  /** 파일에 실을 그림들. 이 함수가 뒤에 붙인다. */
  binaries: Binary[];
  /** 미리 등록한 얇은 선 테두리 번호. */
  thin: number;
  /** 미리 등록한 머리띠(색) 테두리 번호. */
  section: number;
  photo: IljiPhoto;
  /** 머리 칸 글. 「□ 」 는 부르는 쪽이 붙인다. */
  head: string;
  id: number;
  zOrder: number;
}

export function photoTable(input: PhotoTableInput): string {
  const { fills, binaries, thin, section, photo } = input;
  const shots: Cell[] = [photo.before, photo.after].map((bytes, side) => {
    let fill = thin;
    if (bytes) {
      const id = `img${binaries.length + 1}`;
      binaries.push({ id, path: `BinData/${id}.jpg`, bytes });
      fill = fills.imageId(binaries.length - 1);
    }
    return { row: 1, col: side, width: PHOTO_WIDTH, height: PHOTO_HEIGHT, lines: [], fill };
  });
  const captions: Cell[] = photo.pair
    ? ["정비 전", "정비 후"].map((text, side) => ({
        row: 2, col: side, width: PHOTO_WIDTH, height: CAPTION_HEIGHT, lines: [text], char: CHAR.caption, para: PARA.center,
      }))
    : [{ row: 2, col: 0, colSpan: 2, width: PHOTO_TABLE_WIDTH, height: CAPTION_HEIGHT, lines: ["현장 확인"], char: CHAR.caption, para: PARA.center }];
  return table({
    id: input.id,
    zOrder: input.zOrder,
    rows: 3,
    cols: 2,
    width: PHOTO_TABLE_WIDTH,
    height: HEAD_HEIGHT + PHOTO_HEIGHT + CAPTION_HEIGHT,
    fill: thin,
    body: [
      [{ row: 0, col: 0, colSpan: 2, width: PHOTO_TABLE_WIDTH, height: HEAD_HEIGHT, lines: [input.head], fill: section, char: CHAR.section, para: PARA.cell }],
      shots,
      captions,
    ],
  });
}

/** 사진 표 사이의 빈 줄. */
export function photoGap(): string {
  return paragraph({ text: "", char: CHAR.gap });
}
