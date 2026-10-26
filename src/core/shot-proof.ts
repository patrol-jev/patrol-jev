/**
 * 사진 사본에 **찍힌 날짜와 그 출처**를 적어 둔다.
 *
 * 일지와 보고서에 들어가는 사진은 브라우저가 줄이고 잘라 다시 만든 JPEG 다. 다시 만들면 원본의 EXIF 가
 * 사라져서, 파일만 받은 사람은 그 사진이 언제 찍혔는지 알 길이 없다. 그래서 이 도구가 이미 알고 있는
 * 날짜와 시각을 사본의 EXIF 자리에 되돌려 적는다. 받는 쪽은 보고 기간과 사진 날짜를 견줄 수 있다.
 *
 * **출처를 같이 적는다.** 날짜를 안 길이 셋이고 세기가 다르다. 섞으면 받는 쪽이 못 가린다.
 *
 *   exif      원본 파일의 촬영 시각 칸에서 읽었다. 가장 곧다.
 *   stamp     사진에 찍힌 날짜 글자를 옮겨 적은 데서 읽었다(메신저로 받아 EXIF 가 없는 사진).
 *   neighbor  앞뒤 장의 시각에서 미뤘다. 그 장 자체의 증거는 아니다.
 *
 * 날짜를 모르는 장에는 아무것도 적지 않는다. 짐작한 날짜를 적은 사진은 안 적은 것만 못하다.
 *
 * 적는 칸은 둘이다. `DateTimeOriginal`(0x9003) 에 "YYYY:MM:DD HH:MM:SS", `ImageDescription`(0x010E) 에
 * "time-source: exif" 꼴. 시각을 모르면 00:00:00 이다. 바이트를 직접 짓고 읽으므로 브라우저와 노드에서 같게 돈다.
 */

export type ShotSource = "exif" | "stamp" | "neighbor";

export interface ShotProof {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM. 모르면 빈 문자열. */
  time: string;
  from: ShotSource;
}

const SOURCES: ShotSource[] = ["exif", "stamp", "neighbor"];
const NOTE = "time-source: ";

/** 화면이 쓰는 출처 이름(`text`)을 파일에 적는 이름으로. 날짜가 없으면 null. */
export function proofOf(date: string | undefined, time: string | undefined, from: "exif" | "text" | "neighbor" | null | undefined): ShotProof | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !from) return null;
  return { date, time: /^\d{2}:\d{2}/.test(time ?? "") ? (time as string).slice(0, 5) : "", from: from === "text" ? "stamp" : from };
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0) & 0x7f).concat(0);
}

/** `Exif\0\0` 로 시작하는 APP1 칸의 자리와 길이. 없으면 null. */
function findExifSegment(bytes: Uint8Array): { start: number; end: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const size = (bytes[at + 2] << 8) | bytes[at + 3];
    if (size < 2) break;
    const isExif =
      marker === 0xe1 && bytes[at + 4] === 0x45 && bytes[at + 5] === 0x78 && bytes[at + 6] === 0x69 && bytes[at + 7] === 0x66 && bytes[at + 8] === 0 && bytes[at + 9] === 0;
    if (isExif) return { start: at, end: at + 2 + size };
    at += 2 + size;
  }
  return null;
}

/**
 * 사본에 날짜와 출처를 적는다. 이미 있던 EXIF 칸은 걷어 내고 새로 적는다(사본의 것은 이 도구가 적은 것뿐이다).
 * `proof` 가 null 이면 EXIF 칸만 걷어 낸 사본을 돌려준다. JPEG 가 아니면 그대로 돌려준다.
 */
export function writeShotProof(jpeg: Uint8Array, proof: ShotProof | null): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const old = findExifSegment(jpeg);
  const bare = old ? concat(jpeg.subarray(0, old.start), jpeg.subarray(old.end)) : jpeg;
  if (!proof) return bare;

  const note = ascii(`${NOTE}${proof.from}`);
  const clock = ascii(`${proof.date.replace(/-/g, ":")} ${proof.time ? `${proof.time}:00` : "00:00:00"}`);
  // TIFF(큰 끝): 머리 8 · 첫 목록(항목 2) 2+24+4 = 30 · EXIF 목록(항목 1) 2+12+4 = 18 · 값들.
  const ifd0 = 8;
  const exifIfd = ifd0 + 30;
  const noteAt = exifIfd + 18;
  const clockAt = noteAt + note.length;
  const tiff: number[] = [0x4d, 0x4d, 0x00, 0x2a, ...u32(ifd0)];
  tiff.push(...u16(2));
  tiff.push(...u16(0x010e), ...u16(2), ...u32(note.length), ...u32(noteAt));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfd));
  tiff.push(...u32(0));
  tiff.push(...u16(1));
  tiff.push(...u16(0x9003), ...u16(2), ...u32(clock.length), ...u32(clockAt));
  tiff.push(...u32(0));
  tiff.push(...note, ...clock);

  const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const segment = new Uint8Array([0xff, 0xe1, ...u16(body.length + 2), ...body]);
  return concat(bare.subarray(0, 2), segment, bare.subarray(2));
}

/** 사본에 적힌 날짜와 출처. 이 도구가 적은 꼴이 아니면 null. */
export function readShotProof(jpeg: Uint8Array): ShotProof | null {
  const segment = findExifSegment(jpeg);
  if (!segment) return null;
  const tiff = segment.start + 10;
  const end = segment.end;
  const order = String.fromCharCode(jpeg[tiff], jpeg[tiff + 1]);
  if (order !== "MM" && order !== "II") return null;
  const little = order === "II";
  const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  const r16 = (at: number) => (at + 2 <= end ? view.getUint16(at, little) : null);
  const r32 = (at: number) => (at + 4 <= end ? view.getUint32(at, little) : null);
  const entry = (ifd: number, tag: number): number | null => {
    const count = r16(tiff + ifd);
    if (count === null) return null;
    for (let i = 0; i < count; i++) {
      const at = tiff + ifd + 2 + i * 12;
      if (r16(at) === tag) return at;
    }
    return null;
  };
  const text = (at: number | null): string | null => {
    if (at === null || r16(at + 2) !== 2) return null;
    const length = r32(at + 4);
    if (length === null || length < 1 || length > 200) return null;
    const from = length <= 4 ? at + 8 : tiff + (r32(at + 8) ?? 0);
    if (from + length > end) return null;
    let out = "";
    for (let i = 0; i < length; i++) {
      const c = jpeg[from + i];
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return out;
  };

  const first = r32(tiff + 4);
  if (first === null) return null;
  const note = text(entry(first, 0x010e));
  const from = SOURCES.find((s) => note === `${NOTE}${s}`);
  if (!from) return null;
  const pointer = entry(first, 0x8769);
  const exifIfd = pointer === null ? null : r32(pointer + 8);
  if (exifIfd === null) return null;
  const clock = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text(entry(exifIfd, 0x9003)) ?? "");
  if (!clock) return null;
  const time = `${clock[4]}:${clock[5]}`;
  return { date: `${clock[1]}-${clock[2]}-${clock[3]}`, time: time === "00:00" && clock[6] === "00" ? "" : time, from };
}

/** 다시 자르거나 줄여 새로 만든 JPEG 에, 원래 사본에 적혀 있던 것을 옮겨 적는다. 없었으면 그대로다. */
export function carryShotProof(from: Uint8Array, to: Uint8Array): Uint8Array {
  if (from === to) return to;
  const proof = readShotProof(from);
  return proof ? writeShotProof(to, proof) : to;
}

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
