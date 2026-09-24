/**
 * JPEG 파일 앞머리에서 **찍힌 시각 하나만** 읽는다.
 *
 * 범용 EXIF 도구(exifr)가 아이폰 Safari 에서 시각을 못 읽었다. 파일에는 기록이 멀쩡히 있었다
 * (사진 앱에 시각이 보이고, 넘어온 파일 앞머리에 EXIF 자리도 있고, 크기도 원본과 같았다).
 * 그런데 30장 전부 시각이 비었고, 그러면 5분 끊기와 2분 잇기가 통째로 꺼져 자리가 밀린다.
 *
 * 필요한 것은 태그 두 개뿐이다. 그래서 바이트를 직접 따라간다. 브라우저마다 다르게 돌 데가
 * 없고, 노드에서도 똑같이 돌아서 검사할 수 있다. 못 읽으면 null 을 돌려주고, 부르는 쪽이
 * exifr 로 한 번 더 본다(HEIC 는 이쪽이 안 읽는다).
 *
 * 길: JPEG 칸들을 넘기다 `Exif\0\0` 로 시작하는 APP1 을 찾는다 → TIFF 머리(바이트 순서) →
 * 첫 목록에서 EXIF 목록의 자리(0x8769) → 거기서 촬영 시각(0x9003), 없으면 디지털화 시각(0x9004).
 * 파일 수정 시각(0x0132)은 보지 않는다. 사진을 옮기거나 고치면 바뀌는 값이다.
 *
 * 그래도 못 읽으면 **XMP 칸**을 본다. 아이폰 Safari 는 사진첩에서 꺼내 주며 파일을 다시 쓰는데,
 * 그때 EXIF 의 값 자리가 전부 한 곳으로 뭉개져 촬영 시각 자리에서 엉뚱한 글자가 읽힌다
 * (실물 30장 전부, exifr 도 같은 자리를 읽어 같이 실패). 그 파일의 XMP 에는 시각이 멀쩡히 있다
 * (`xmp:CreateDate` · `photoshop:DateCreated`). EXIF 가 먼저이고 XMP 는 그 다음이다.
 */

export type ExifTime = { date: string; time: string; stamp: number };

const TAG_EXIF_IFD = 0x8769;
const TAG_TAKEN = 0x9003;
const TAG_DIGITIZED = 0x9004;
/** 파일 수정 시각(첫 목록). 시각으로는 안 쓰고, 못 읽을 때 무슨 글자가 있는지 보이는 데만 쓴다. */
const TAG_MODIFIED = 0x0132;

export function readExifTime(bytes: Uint8Array): ExifTime | null {
  return explainExifTime(bytes).time;
}

/**
 * 같은 읽기에 **못 읽은 까닭**을 붙인 것. 어느 폰에서 왜 비는지 사람이 전해 줄 수 있어야 한다.
 * 까닭은 짧은 한국어 한 마디다. 화면 알림에 그대로 실린다.
 */
export function explainExifTime(bytes: Uint8Array): { time: ExifTime | null; why: string } {
  if (bytes.length === 0) return { time: null, why: "파일 머리 0바이트" };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { time: null, why: "JPEG 아님" };
  const tiff = findTiff(bytes);
  if (tiff === null) return { time: null, why: "Exif 칸 없음" };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[tiff], bytes[tiff + 1]);
  if (order !== "II" && order !== "MM") return { time: null, why: "TIFF 머리 이상" };
  const little = order === "II";

  const u16 = (at: number) => (at + 2 <= bytes.length ? view.getUint16(at, little) : null);
  const u32 = (at: number) => (at + 4 <= bytes.length ? view.getUint32(at, little) : null);

  if (u16(tiff + 2) !== 42) return { time: null, why: "TIFF 머리 이상" };
  const first = u32(tiff + 4);
  if (first === null) return { time: null, why: "TIFF 머리 이상" };

  const exifAt = findEntry(tiff, first, TAG_EXIF_IFD, u16, u32);
  if (!exifAt) return { time: null, why: "Exif 목록 없음" };
  const exifIfd = u32(exifAt + 8);
  if (exifIfd === null) return { time: null, why: "Exif 목록 없음" };

  let why = "";
  for (const tag of [TAG_TAKEN, TAG_DIGITIZED]) {
    const entry = findEntry(tiff, exifIfd, tag, u16, u32);
    if (!entry) continue;
    const text = asciiOf(bytes, tiff, entry, u16, u32);
    if (text === null) {
      // 글자가 아니거나 자리가 앞머리 밖이다. 어느 쪽인지 숫자로 남긴다.
      why = why || `시각 값 꼴 이상 (type ${u16(entry + 2)} · ${u32(entry + 4)}자)`;
      continue;
    }
    const parsed = parseClock(text);
    if (parsed) return { time: parsed, why: "" };
    // 읽은 글자를 그대로 보인다. 어느 폰이 무슨 글자를 써 두는지 이것 없이는 모른다.
    why = why || `시각 글자 이상 「${shown(text)}」`;
  }
  // EXIF 가 뭉개졌으면 XMP 에서 한 번 더. 폰이 다시 쓴 파일은 이쪽에 시각이 남아 있다.
  const fromXmp = readXmpTime(bytes);
  if (fromXmp) return { time: fromXmp, why: "" };

  // 첫 목록의 수정 시각 글자도 같이 보인다. 폰이 파일을 다시 썼을 때 어느 자리가 멀쩡한지 가른다.
  const modified = findEntry(tiff, first, TAG_MODIFIED, u16, u32);
  const modifiedText = modified ? asciiOf(bytes, tiff, modified, u16, u32) : null;
  const tail = modifiedText === null ? "" : ` · 수정 시각 「${shown(modifiedText)}」`;
  return { time: null, why: `${why || "촬영 시각 태그 없음"}${tail} · XMP 에도 없음` };
}

const XMP_HEAD = "http://ns.adobe.com/xap/1.0/";

/**
 * XMP 칸의 촬영 시각. 세 이름을 차례로 본다: `exif:DateTimeOriginal` · `photoshop:DateCreated` ·
 * `xmp:CreateDate`. 속성 꼴(`이름="값"`)과 요소 꼴(`<이름>값</이름>`) 둘 다 받는다.
 * `xmp:ModifyDate` 는 안 본다. 수정 시각이다.
 */
export function readXmpTime(bytes: Uint8Array): ExifTime | null {
  const xmp = findXmp(bytes);
  if (xmp === null) return null;
  for (const name of ["exif:DateTimeOriginal", "photoshop:DateCreated", "xmp:CreateDate"]) {
    const attribute = new RegExp(`${name}="([^"]{16,40})"`).exec(xmp);
    const element = new RegExp(`<${name}>([^<]{16,40})</${name}>`).exec(xmp);
    const text = attribute?.[1] ?? element?.[1];
    const parsed = text ? parseClock(text) : null;
    if (parsed) return parsed;
  }
  return null;
}

/** `http://ns.adobe.com/xap/1.0/\0` 로 시작하는 APP1 칸의 글자. 없으면 null. */
function findXmp(bytes: Uint8Array): string | null {
  for (const segment of segmentsOf(bytes)) {
    if (segment.marker !== 0xe1) continue;
    const { body, end } = segment;
    if (end - body < XMP_HEAD.length + 1) continue;
    let matches = true;
    for (let i = 0; i < XMP_HEAD.length; i++) {
      if (bytes[body + i] !== XMP_HEAD.charCodeAt(i)) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    let text = "";
    for (let i = body + XMP_HEAD.length + 1; i < end; i++) text += String.fromCharCode(bytes[i]);
    return text;
  }
  return null;
}

/**
 * JPEG 칸들을 앞에서부터. 그림 자료(SOS)가 시작되면 멈춘다. 잘린 칸은 내지 않는다.
 * `findTiff` 와 `findXmp` 가 같은 길을 걷는다.
 */
function* segmentsOf(bytes: Uint8Array): Generator<{ marker: number; body: number; end: number }> {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return;
    const marker = bytes[at + 1];
    // 길이가 없는 표시들. 채움 바이트(0xff)도 여기서 넘긴다.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    // 그림 자료가 시작되면 그 뒤에는 기록이 없다.
    if (marker === 0xda || marker === 0xd9) return;

    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return;
    const body = at + 4;
    const end = Math.min(bytes.length, at + 2 + length);
    yield { marker, body, end };
    at += 2 + length;
  }
}

/** 글자를 화면에 보일 만큼만. 안 보이는 글자는 `?` 로, 24자에서 끊는다. */
function shown(text: string): string {
  let out = "";
  for (const ch of text.slice(0, 24)) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code > 0x7e ? "?" : ch;
  }
  return text.length > 24 ? `${out}…` : out;
}

/** `Exif\0\0` 로 시작하는 APP1 칸을 찾아 TIFF 머리의 자리를 돌려준다. */
function findTiff(bytes: Uint8Array): number | null {
  for (const { marker, body } of segmentsOf(bytes)) {
    if (
      marker === 0xe1 &&
      body + 6 <= bytes.length &&
      bytes[body] === 0x45 &&
      bytes[body + 1] === 0x78 &&
      bytes[body + 2] === 0x69 &&
      bytes[body + 3] === 0x66 &&
      bytes[body + 4] === 0 &&
      bytes[body + 5] === 0
    ) {
      return body + 6;
    }
  }
  return null;
}

/** 목록 하나에서 태그를 찾아 그 항목(12바이트)의 자리를 돌려준다. */
function findEntry(
  tiff: number,
  ifd: number,
  tag: number,
  u16: (at: number) => number | null,
  u32: (at: number) => number | null,
): number | null {
  const start = tiff + ifd;
  const count = u16(start);
  if (count === null || count > 1000) return null;
  for (let i = 0; i < count; i++) {
    const entry = start + 2 + i * 12;
    if (u32(entry + 8) === null) return null;
    if (u16(entry) === tag) return entry;
  }
  return null;
}

/** 항목의 글자 값. 네 바이트를 넘으면 값은 TIFF 머리 기준 다른 자리에 있다. */
function asciiOf(
  bytes: Uint8Array,
  tiff: number,
  entry: number,
  u16: (at: number) => number | null,
  u32: (at: number) => number | null,
): string | null {
  if (u16(entry + 2) !== 2) return null; // ASCII 가 아니면 시각이 아니다.
  const count = u32(entry + 4);
  if (count === null || count === 0 || count > 64) return null;
  const at = count <= 4 ? entry + 8 : tiff + (u32(entry + 8) ?? -1);
  if (at < 0 || at + count > bytes.length) return null;
  let text = "";
  for (let i = 0; i < count; i++) {
    const code = bytes[at + i];
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

/**
 * `2026:09:10 08:32:42`(EXIF) 또는 `2026-09-10T08:32:42`(XMP) → 그 사진을 찍은 곳의 벽시계 시각.
 * 시간대 표기는 보지 않는다. exifr 도 이렇게 읽었고, 화면에 적는 것도 벽시계 시각이다.
 */
function parseClock(text: string): ExifTime | null {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map((v) => Number(v ?? 0));
  if (year < 1990 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }
  const value = new Date(year, month - 1, day, hour, minute, second || 0);
  if (Number.isNaN(value.getTime())) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${m[4]}:${m[5]}`,
    stamp: value.getTime(),
  };
}
