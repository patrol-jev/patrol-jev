/**
 * JPEG 찍힌 시각 읽기 회귀 검사.
 *
 * `src/core/exif-time.ts` 를 고쳤으면 이걸 돌리세요. **API 를 부르지 않습니다**. 사진도
 * 들어가지 않습니다. 검사할 JPEG 앞머리는 여기서 바이트로 만듭니다.
 *
 *   npm run check:exif
 *
 * 가진 사진 폴더로도 돌릴 수 있습니다. 같은 파일을 exifr 로도 읽어 둘이 같은지 봅니다.
 *
 *   npm run check:exif -- --dir <사진폴더>
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readExifTime } from "../src/core/exif-time.ts";

/** 촬영 시각을 담은 JPEG 앞머리를 만든다. 그림 자료는 없고 칸 구조만 진짜와 같다. */
function jpeg({ little = true, taken = null, digitized = null, before = [], xmp = null, after = [] } = {}) {
  const tags = [];
  if (taken) tags.push([0x9003, taken]);
  if (digitized) tags.push([0x9004, digitized]);

  const exifIfd = 26;
  const dataAt = exifIfd + 2 + tags.length * 12 + 4;
  const tiff = new Uint8Array(dataAt + tags.length * 20);
  const view = new DataView(tiff.buffer);
  tiff.set(little ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);

  // 첫 목록: EXIF 목록의 자리 하나.
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x8769, little);
  view.setUint16(12, 4, little);
  view.setUint32(14, 1, little);
  view.setUint32(18, exifIfd, little);
  view.setUint32(22, 0, little);

  view.setUint16(exifIfd, tags.length, little);
  tags.forEach(([tag, text], i) => {
    const entry = exifIfd + 2 + i * 12;
    const at = dataAt + i * 20;
    view.setUint16(entry, tag, little);
    view.setUint16(entry + 2, 2, little);
    view.setUint32(entry + 4, 20, little);
    view.setUint32(entry + 8, at, little);
    for (let k = 0; k < 19; k++) tiff[at + k] = text.charCodeAt(k) || 0;
  });

  const app1 = [..."Exif"].map((c) => c.charCodeAt(0)).concat([0, 0], [...tiff]);
  const segments = [...before, [0xe1, app1], ...after];
  // XMP 칸. 아이폰이 다시 쓴 파일은 EXIF 뒤에 이 칸이 따로 온다.
  if (xmp !== null) {
    segments.push([0xe1, [..."http://ns.adobe.com/xap/1.0/\0"].map((c) => c.charCodeAt(0)).concat([...xmp].map((c) => c.charCodeAt(0)))]);
  }
  const out = [0xff, 0xd8];
  for (const [marker, body] of segments) {
    const length = body.length + 2;
    out.push(0xff, marker, length >> 8, length & 0xff, ...body);
  }
  out.push(0xff, 0xda, 0, 2);
  return new Uint8Array(out);
}

const CASES = [
  ["리틀 엔디언(안드로이드·아이폰 흔한 꼴)", jpeg({ taken: "2026:09:10 08:32:42" }), "2026-09-10", "08:32"],
  ["빅 엔디언", jpeg({ little: false, taken: "2026:05:12 06:28:00" }), "2026-05-12", "06:28"],
  ["촬영 시각이 없으면 디지털화 시각", jpeg({ digitized: "2026:05:12 21:05:10" }), "2026-05-12", "21:05"],
  ["둘 다 있으면 촬영 시각이 먼저", jpeg({ taken: "2026:05:12 09:00:00", digitized: "2026:05:13 10:00:00" }), "2026-05-12", "09:00"],
  [
    "앞에 다른 칸(JFIF·ICC)이 있어도 찾는다",
    jpeg({ taken: "2026:09:10 07:11:59", before: [[0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1]], [0xe2, new Array(600).fill(7)]] }),
    "2026-09-10",
    "07:11",
  ],
  ["시각 태그가 없으면 비운다", jpeg({}), null, null],
  ["시각 꼴이 아니면 비운다", jpeg({ taken: "0000:00:00 00:00:00" }), null, null],
  ["JPEG 이 아니면 비운다", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), null, null],
  ["중간에 잘렸으면 비운다", jpeg({ taken: "2026:09:10 08:32:42" }).slice(0, 40), null, null],
  [
    "EXIF 가 뭉개졌으면 XMP 에서 읽는다(아이폰이 다시 쓴 파일)",
    jpeg({ taken: "F50XLPE00SM", xmp: '<x:xmpmeta><rdf:Description photoshop:DateCreated="2026-09-10T08:32:42" xmp:ModifyDate="2026-09-11T00:00:00" xmp:CreateDate="2026-09-10T08:32:42"/></x:xmpmeta>' }),
    "2026-09-10",
    "08:32",
  ],
  [
    "XMP 요소 꼴도 읽는다",
    jpeg({ xmp: "<rdf:Description><exif:DateTimeOriginal>2026-05-12T06:28:00+09:00</exif:DateTimeOriginal></rdf:Description>" }),
    "2026-05-12",
    "06:28",
  ],
  ["EXIF 가 멀쩡하면 XMP 보다 먼저", jpeg({ taken: "2026:05:12 09:00:00", xmp: 'xmp:CreateDate="2026-05-13T10:00:00"' }), "2026-05-12", "09:00"],
  ["XMP 에 수정 시각뿐이면 비운다", jpeg({ xmp: 'xmp:ModifyDate="2026-09-11T00:00:00"' }), null, null],
];

let failed = 0;
for (const [name, bytes, date, time] of CASES) {
  const got = readExifTime(bytes);
  const ok = date === null ? got === null : got?.date === date && got?.time === time;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : `  기대 ${date} ${time} · 받음 ${got ? `${got.date} ${got.time}` : "null"}`}`);
}

// 가진 사진 폴더와 exifr 대조. 폴더 이름도 사진도 출력하지 않는다(장수와 어긋난 수만).
const dirAt = process.argv.indexOf("--dir");
if (dirAt > 0) {
  const dir = process.argv[dirAt + 1];
  const exifr = (await import("exifr")).default;
  const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f));
  let same = 0;
  for (const f of files) {
    const bytes = new Uint8Array(readFileSync(join(dir, f)));
    const mine = readExifTime(bytes.slice(0, 256 * 1024));
    const tags = await exifr.parse(Buffer.from(bytes), ["DateTimeOriginal", "CreateDate"]).catch(() => null);
    const theirs = tags?.DateTimeOriginal ?? tags?.CreateDate ?? null;
    if (mine && theirs && mine.stamp === theirs.getTime()) same++;
    else if (!mine && !theirs) same++;
  }
  const ok = same === files.length;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} 사진 폴더 ${files.length}장 가운데 exifr 와 같은 시각 ${same}장`);
}

if (failed > 0) {
  console.error(`\n${failed}건 틀림`);
  process.exit(1);
}
console.log("\n전부 맞습니다.");
