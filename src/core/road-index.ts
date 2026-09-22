/**
 * 도로명 색인 읽기. **서버에서만** 부른다(파일을 읽는다).
 *
 * 색인은 `npm run roads:build` 가 `road/dong/` 아래에 동마다 한 장씩 만들어 둔 것이다.
 * 레포에는 들어 있지 않다 — 담당자가 자기 기계에서 한 번 만든다.
 * 없으면 목록이 비고, 주소는 읽은 그대로 쓰인다. 도구는 그대로 돈다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RoadIndex } from "./roads";

const ROAD_DIR = "road";

export interface DongChoice {
  /** 파일 이름이자 고르는 값. 「○○구_○○동」 꼴. */
  name: string;
  sigungu: string;
  dong: string;
  roads: number;
  buildings: number;
}

let listing: DongChoice[] | null = null;
const loaded = new Map<string, RoadIndex | null>();

/** 고를 수 있는 동 목록. 색인이 없으면 빈 배열. */
export function listDongs(): DongChoice[] {
  if (listing) return listing;
  try {
    const raw = readFileSync(join(process.cwd(), ROAD_DIR, "dong-list.json"), "utf8");
    const parsed = JSON.parse(raw) as { dongs?: DongChoice[] };
    listing = Array.isArray(parsed.dongs) ? parsed.dongs : [];
  } catch {
    listing = [];
  }
  return listing;
}

/**
 * 동 하나의 색인. 한 번 읽으면 들고 있는다(동마다 수십 KB).
 *
 * 고른 값이 파일 이름이 되므로 **경로로 쓸 수 없는 글자는 거른다** — 브라우저가 보낸 값이
 * 그대로 파일 경로가 되면 안 된다.
 */
export function loadDong(name: string | null | undefined): RoadIndex | null {
  if (!name) return null;
  if (!/^[가-힣A-Za-z0-9]+_[가-힣A-Za-z0-9·]+$/.test(name)) return null;
  if (loaded.has(name)) return loaded.get(name) ?? null;

  let index: RoadIndex | null = null;
  try {
    const raw = readFileSync(join(process.cwd(), ROAD_DIR, "dong", `${name}.json`), "utf8");
    const parsed = JSON.parse(raw) as RoadIndex;
    if (parsed && typeof parsed.buildings === "object") index = parsed;
  } catch {
    index = null;
  }
  loaded.set(name, index);
  return index;
}
