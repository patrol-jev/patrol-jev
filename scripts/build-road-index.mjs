/**
 * 도로명주소 색인 만들기.
 *
 * 행정안전부 「도로명주소 한글」 파일(TXT)에서 **담당자가 고른 동의 도로명만** 추려
 * 작은 색인으로 만듭니다. 주소판에서 읽은 글자를 코드가 대조·교정할 때 씁니다.
 *
 *   1. https://business.juso.go.kr 에서 「도로명주소 한글」을 내려받습니다(시·도 단위).
 *   2. 압축을 풀어 `road/` 아래에 둡니다(예: road/rnaddrkor_seoul.txt).
 *   3. (선택) 같은 곳 「제공하는 주소(도형, 좌표)」 탭의 「위치정보요약DB」(TXT) 나 「도로명주소 출입구 정보」(TXT)
 *      도 풀어 둡니다. 건물 출입구 좌표입니다. 이것이 있으면 사진의 찍힌 자리(GPS)로 주소를 채울 수 있습니다.
 *      파일 이름에 entrc·출입구·위치정보 가운데 하나가 들어 있으면 알아서 읽습니다.
 *   4. npm run roads:build
 *
 * 만들어진 색인은 `road/dong/` 아래에 동마다 한 장씩 들어갑니다. 레포에 커밋되지 않습니다
 * (지명이 든 파일이고, 원본 저작권·용량 문제도 있습니다).
 *
 * 파일 꼴: 「|」로 나뉜 CP949 텍스트. 우리가 쓰는 칸은 넷뿐입니다.
 *   4=시군구  11=도로명  13=건물본번  14=건물부번  16=행정동
 *
 * 출입구 좌표 파일은 칸이 이렇습니다(1부터 셈). 위치정보요약DB 와 출입구 정보가 앞 열한 칸은 같습니다.
 *   5=시군구명  8=도로명  10=건물본번  11=건물부번  … X좌표  Y좌표(뒤쪽 큰 숫자 두 칸)
 *   행정동은 이 파일에서 읽지 않습니다. 도로명주소 한글 파일이 「시군구·도로명·건물번호 → 행정동」을
 *   이미 알고 있으니 그것으로 잇습니다. 좌표는 UTM-K(EPSG:5179) 미터. 서울이면 x 94만~97만, y 194만~197만.
 *   DB 가 아직 없으면 `scripts/fetch-entrances.mjs` 가 좌표제공 API 로 같은 꼴의 파일(entrc_api_*.txt, UTF-8 BOM)을 만든다.
 */

import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROAD_DIR = "road";
const OUT_DIR = join(ROAD_DIR, "dong");

const COL = { sido: 2, sigungu: 3, road: 10, main: 12, sub: 13, dong: 15 }; // 0-based

const files = (await readdir(ROAD_DIR).catch(() => []))
  .filter((name) => /^rnaddrkor.*\.txt$/i.test(name))
  .map((name) => join(ROAD_DIR, name));

if (files.length === 0) {
  console.error(
    `${ROAD_DIR}/ 에 도로명주소 한글 파일(rnaddrkor*.txt)이 없습니다.\n` +
      "https://business.juso.go.kr 에서 「도로명주소 한글」을 내려받아 풀어 두세요.",
  );
  process.exit(1);
}

/** 「시군구\u0000행정동」 → { 도로명 → 건물번호 Set } */
const byDong = new Map();
/** 「시군구|도로명|건물번호」 → 행정동. 출입구 좌표를 동에 잇는 데 쓴다. */
const dongOfAddress = new Map();
let rows = 0;

for (const path of files) {
  console.log(`읽는 중: ${path}`);
  await eachLine(path, (line) => {
    const cells = line.split("|");
    if (cells.length < 17) return;

    const dong = cells[COL.dong].trim();
    const road = cells[COL.road].trim();
    if (!dong || !road) return;

    const main = Number(cells[COL.main]);
    const sub = Number(cells[COL.sub]);
    if (!Number.isFinite(main) || main <= 0) return;

    const key = `${cells[COL.sigungu].trim()}\u0000${dong}`;
    let roads = byDong.get(key);
    if (!roads) byDong.set(key, (roads = new Map()));

    let numbers = roads.get(road);
    if (!numbers) roads.set(road, (numbers = new Set()));
    const number = sub > 0 ? `${main}-${sub}` : `${main}`;
    numbers.add(number);
    dongOfAddress.set(`${cells[COL.sigungu].trim()}|${road}|${number}`, dong);
    rows++;
  });
}

// ── 위치정보요약DB(출입구 좌표). 있을 때만.
const entranceFiles = (await readdir(ROAD_DIR).catch(() => []))
  .filter((name) => /\.txt$/i.test(name) && /entrc|entrance|출입구|위치정보/i.test(name))
  .map((name) => join(ROAD_DIR, name));
/** 「시군구\u0000행정동」 → [x, y, "도로명 번호"][] */
const pointsByDong = new Map();
let pointRows = 0;
let unmatched = 0;
let shownSample = false;
for (const path of entranceFiles) {
  console.log(`읽는 중(출입구 좌표): ${path}`);
  await eachLine(path, (line) => {
    const cells = line.split("|");
    if (cells.length < 13) return;
    // 좌표 두 칸: 뒤에서부터 숫자 두 칸(수십만~수백만). 판이 달라 칸이 밀려도 잡히게.
    let xi = -1;
    for (let i = cells.length - 1; i >= 1; i--) {
      const x = Number(cells[i - 1]);
      const y = Number(cells[i]);
      if (Number.isFinite(x) && Number.isFinite(y) && x > 100000 && y > 100000) {
        xi = i - 1;
        break;
      }
    }
    if (xi < 0) return;
    const x = Math.round(Number(cells[xi]));
    const y = Math.round(Number(cells[xi + 1]));
    const sigungu = cells[4].trim();
    const road = cells[7].trim();
    const main = Number(cells[9]);
    const sub = Number(cells[10]);
    if (!sigungu || !road || !Number.isFinite(main) || main <= 0) return;
    const number = sub > 0 ? `${main}-${sub}` : `${main}`;
    const dong = dongOfAddress.get(`${sigungu}|${road}|${number}`);
    if (!shownSample) {
      shownSample = true;
      console.log(
        `  칸 확인: 시군구 「${sigungu}」 도로명 「${road}」 번호 ${number} 좌표 ${x},${y}` +
          ` → 행정동 「${dong ?? "(도로명주소 한글에 없음)"}」\n` +
          "  (서울이면 좌표가 x 94만~97만 · y 194만~197만 이어야 합니다. 아니면 좌표계가 다른 파일입니다.)",
      );
    }
    if (!dong) {
      unmatched++;
      return;
    }
    const key = `${sigungu}\u0000${dong}`;
    let list = pointsByDong.get(key);
    if (!list) pointsByDong.set(key, (list = []));
    list.push([x, y, `${road} ${number}`]);
    pointRows++;
  });
}

await mkdir(OUT_DIR, { recursive: true });

const builtAt = new Date().toISOString().slice(0, 10);
const listing = [];

for (const [key, roads] of byDong) {
  const [sigungu, dong] = key.split("\u0000");
  const name = `${sigungu}_${dong}`;

  const sorted = [...roads.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  const points = pointsByDong.get(key) ?? [];
  const index = {
    sigungu,
    dong,
    builtAt,
    source: points.length > 0 ? "도로명주소 한글 · 위치정보요약DB (행정안전부)" : "도로명주소 한글 (행정안전부)",
    buildings: Object.fromEntries(sorted.map(([road, numbers]) => [road, [...numbers].sort(compareNumbers)])),
    ...(points.length > 0 ? { points } : {}),
  };

  await writeFile(join(OUT_DIR, `${name}.json`), JSON.stringify(index));
  listing.push({ name, sigungu, dong, roads: sorted.length, buildings: [...roads.values()].reduce((n, s) => n + s.size, 0) });
}

listing.sort((a, b) => a.sigungu.localeCompare(b.sigungu) || a.dong.localeCompare(b.dong));
await writeFile(join(ROAD_DIR, "dong-list.json"), JSON.stringify({ builtAt, dongs: listing }, null, 1));

console.log(
  `\n색인 ${listing.length}개 동 · 주소 ${rows.toLocaleString()}건 · 출입구 좌표 ${pointRows.toLocaleString()}점` +
    (unmatched > 0 ? `(주소 못 찾은 점 ${unmatched.toLocaleString()})` : "") +
    ` → ${OUT_DIR}/\n` +
    `동 목록 → ${join(ROAD_DIR, "dong-list.json")}`,
);

/** 「9-2」가 「10」보다 앞에 오게. 사람이 목록을 눈으로 훑을 때를 위한 것뿐이다. */
function compareNumbers(a, b) {
  const [am, as] = a.split("-").map(Number);
  const [bm, bs] = b.split("-").map(Number);
  return am - bm || (as ?? 0) - (bs ?? 0);
}

/**
 * 파일을 줄 단위로. 78MB 를 통째로 문자열로 만들지 않으려고 흘려 읽는다.
 * 행정안전부 파일은 CP949. 앞머리에 BOM(EF BB BF)이 있으면 UTF-8(fetch-entrances 가 만든 파일).
 */
async function eachLine(path, onLine) {
  let decoder = null;
  let rest = "";

  for await (let chunk of createReadStream(path)) {
    if (!decoder) {
      const bom = chunk.length >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf;
      decoder = new TextDecoder(bom ? "utf-8" : "euc-kr");
      if (bom) chunk = chunk.subarray(3);
    }
    const text = rest + decoder.decode(chunk, { stream: true });
    const lines = text.split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) if (line) onLine(line);
  }
  const tail = rest + (decoder ?? new TextDecoder("euc-kr")).decode();
  if (tail.trim()) onLine(tail);
}
