/**
 * 도로명주소 색인 만들기.
 *
 * 행정안전부 「도로명주소 한글」 파일(TXT)에서 **담당자가 고른 동의 도로명만** 추려
 * 작은 색인으로 만듭니다. 주소판에서 읽은 글자를 코드가 대조·교정할 때 씁니다.
 *
 *   1. https://business.juso.go.kr 에서 「도로명주소 한글」을 내려받습니다(시·도 단위).
 *   2. 압축을 풀어 `road/` 아래에 둡니다(예: road/rnaddrkor_seoul.txt).
 *   3. npm run roads:build
 *
 * 만들어진 색인은 `road/dong/` 아래에 동마다 한 장씩 들어갑니다. 레포에 커밋되지 않습니다
 * (지명이 든 파일이고, 원본 저작권·용량 문제도 있습니다).
 *
 * 파일 꼴: 「|」로 나뉜 CP949 텍스트. 우리가 쓰는 칸은 넷뿐입니다.
 *   4=시군구  11=도로명  13=건물본번  14=건물부번  16=행정동
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
let rows = 0;

for (const path of files) {
  console.log(`읽는 중 — ${path}`);
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
    numbers.add(sub > 0 ? `${main}-${sub}` : `${main}`);
    rows++;
  });
}

await mkdir(OUT_DIR, { recursive: true });

const builtAt = new Date().toISOString().slice(0, 10);
const listing = [];

for (const [key, roads] of byDong) {
  const [sigungu, dong] = key.split("\u0000");
  const name = `${sigungu}_${dong}`;

  const sorted = [...roads.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  const index = {
    sigungu,
    dong,
    builtAt,
    source: "도로명주소 한글 (행정안전부)",
    buildings: Object.fromEntries(sorted.map(([road, numbers]) => [road, [...numbers].sort(compareNumbers)])),
  };

  await writeFile(join(OUT_DIR, `${name}.json`), JSON.stringify(index));
  listing.push({ name, sigungu, dong, roads: sorted.length, buildings: [...roads.values()].reduce((n, s) => n + s.size, 0) });
}

listing.sort((a, b) => a.sigungu.localeCompare(b.sigungu) || a.dong.localeCompare(b.dong));
await writeFile(join(ROAD_DIR, "dong-list.json"), JSON.stringify({ builtAt, dongs: listing }, null, 1));

console.log(
  `\n색인 ${listing.length}개 동 · 주소 ${rows.toLocaleString()}건 → ${OUT_DIR}/\n` +
    `동 목록 → ${join(ROAD_DIR, "dong-list.json")}`,
);

/** 「9-2」가 「10」보다 앞에 오게. 사람이 목록을 눈으로 훑을 때를 위한 것뿐이다. */
function compareNumbers(a, b) {
  const [am, as] = a.split("-").map(Number);
  const [bm, bs] = b.split("-").map(Number);
  return am - bm || (as ?? 0) - (bs ?? 0);
}

/** CP949 파일을 줄 단위로. 78MB 를 통째로 문자열로 만들지 않으려고 흘려 읽는다. */
async function eachLine(path, onLine) {
  const decoder = new TextDecoder("euc-kr");
  let rest = "";

  for await (const chunk of createReadStream(path)) {
    const text = rest + decoder.decode(chunk, { stream: true });
    const lines = text.split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) if (line) onLine(line);
  }
  const tail = rest + decoder.decode();
  if (tail.trim()) onLine(tail);
}
