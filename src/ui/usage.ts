"use client";

import type { SavedSpot } from "@/core/period";
import type { UsageRecord } from "@/core/types";

/**
 * 사용 로그.
 *
 * **아무 데도 보내지 않는다.** 이 브라우저의 localStorage 에만 쌓인다.
 * 공개 레포라 이 문장이 코드와 어긋나면 안 된다. 보내는 코드는 여기에 없다.
 *
 * 남기는 것: 몇 장, 몇 묶음, 몇 초, 몇 번 고쳤나, 복사했나.
 * 남기지 않는 것: 사진, 주소, 사람, 동 이름, 기기 정보.
 */

const RECORDS = "patrol-jev.runs";
const BASELINE = "patrol-jev.baseline";
const DONG = "patrol-jev.dong";

export function readRuns(): UsageRecord[] {
  try {
    const raw = localStorage.getItem(RECORDS);
    return raw ? (JSON.parse(raw) as UsageRecord[]) : [];
  } catch {
    return [];
  }
}

export function appendRun(record: UsageRecord, mode: "local" | "off"): void {
  if (mode === "off") return;
  try {
    const runs = readRuns();
    runs.push(record);
    // 오래된 것부터 버린다. 브라우저 저장 공간을 붙잡고 있을 이유가 없다.
    localStorage.setItem(RECORDS, JSON.stringify(runs.slice(-500)));
  } catch {
    // 저장이 안 되는 브라우저에서도 도구는 그대로 돌아야 한다.
  }
}

/**
 * 도입 전 기준선. 첫 실행 때 한 번만 묻는다.
 * 이게 없으면 나중에 「얼마나 줄었나」를 말할 수 없다. 그래서 묻되, 건너뛸 수 있게 둔다.
 */
export function readBaseline(): number | null {
  try {
    const raw = localStorage.getItem(BASELINE);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function baselineAsked(): boolean {
  try {
    return localStorage.getItem(BASELINE) !== null;
  } catch {
    return true;
  }
}

export function writeBaseline(minutes: number | null): void {
  try {
    localStorage.setItem(BASELINE, minutes === null ? "" : String(minutes));
  } catch {
    // 못 적어도 그만이다.
  }
}

/**
 * 담당자가 고른 동. 주소를 그 동의 도로명으로 대조할 때 쓴다.
 * 이 브라우저에만 남는다. 한 번 고르면 다음에도 그대로다.
 */
export function readDong(): string | null {
  try {
    const value = localStorage.getItem(DONG);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeDong(name: string | null): void {
  try {
    if (name) localStorage.setItem(DONG, name);
    else localStorage.removeItem(DONG);
  } catch {
    // 못 적어도 그만이다. 그 회차만 안 기억할 뿐이다.
  }
}

/** 로그를 한 줄 요약으로. 환류 자료에 그대로 옮겨 적을 수 있게. */
export function summarise(runs: UsageRecord[]): {
  runs: number;
  photos: number;
  medianSeconds: number;
  baselineMinutes: number | null;
} {
  const seconds = runs
    .map((run) => (run.visionMs + run.firstPassMs) / 1000)
    .sort((a, b) => a - b);
  const middle = seconds.length > 0 ? seconds[Math.floor(seconds.length / 2)] : 0;

  return {
    runs: runs.length,
    photos: runs.reduce((sum, run) => sum + run.photos, 0),
    medianSeconds: Math.round(middle * 10) / 10,
    baselineMinutes: readBaseline(),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 사람이 고친 것을 기억하기 · 지난 날짜의 일지
 *
 * 둘 다 이 브라우저의 localStorage 에만 쌓인다. 보내는 코드는 없다.
 * ──────────────────────────────────────────────────────────────────────────── */

const LEARNED = "patrol-jev.learned";
const WORDING = "patrol-jev.wording";
const PASS = "patrol-jev.pass";
const DAYS = "patrol-jev.days";

/** 자리 하나에 대해 사람이 정해 준 갈래. 같은 자리면 다음에도 그 갈래로 둔다. */
export type LearnedLanes = Record<string, string>;

/** 주소는 띄어쓰기가 들쭉날쭉하다. 붙여서 견준다. */
function addressKey(address: string): string {
  return address.replace(/\s+/g, "");
}

export function readLearned(): LearnedLanes {
  try {
    const raw = localStorage.getItem(LEARNED);
    return raw ? (JSON.parse(raw) as LearnedLanes) : {};
  } catch {
    return {};
  }
}

/**
 * 사람이 고친 갈래를 그 자리에 붙여 기억한다.
 *
 * 기억하는 것은 **주소가 있는 자리뿐**이다. 주소가 없으면 다음에 같은 자리인지 알 길이 없고,
 * 모르는 것을 같다고 치면 엉뚱한 자리에 남의 판단이 붙는다.
 */
export function learnLane(address: string, lane: string): void {
  const key = addressKey(address);
  if (key.length === 0) return;
  try {
    const learned = readLearned();
    learned[key] = lane;
    localStorage.setItem(LEARNED, JSON.stringify(learned));
  } catch {
    // 못 적어도 그만이다. 그 회차만 기억 못 할 뿐이다.
  }
}

export function forgetLanes(): void {
  try {
    localStorage.removeItem(LEARNED);
  } catch {
    // 지우지 못해도 도구는 돈다.
  }
}

/** 이 자리에 대해 기억해 둔 갈래. 없으면 null. */
export function recallLane(address: string, learned: LearnedLanes): string | null {
  const key = addressKey(address);
  return key.length > 0 ? (learned[key] ?? null) : null;
}

/**
 * 하루치 기록. 글과 자리 목록이다. 사진은 여기 담지 않는다(localStorage 는 몇 MB 가 한계다).
 * 일지에 실린 사진의 작은 사본은 `photo-store.ts`(IndexedDB)에 같은 날짜로 따로 남는다.
 */
export interface DayRecord {
  /** YYYY-MM-DD */
  date: string;
  savedAt: string;
  photos: number;
  groups: number;
  /** 그날 만든 일지 글 전체. 복사해 쓰라고 그대로 둔다. */
  report: string;
  dong: string;
  /** 일지에 실린 자리들(란 · 주소 · 말). 기간 보고서가 이것을 센다. 이 칸이 생기기 전 기록에는 없다. */
  spots?: SavedSpot[];
  /** 갈래를 못 정해 일지에 안 실린 자리 수. */
  undecided?: number;
}

export function readDays(): DayRecord[] {
  try {
    const raw = localStorage.getItem(DAYS);
    const parsed = raw ? (JSON.parse(raw) as DayRecord[]) : [];
    return Array.isArray(parsed) ? parsed.filter((day) => day && typeof day.date === "string") : [];
  } catch {
    return [];
  }
}

/** 같은 날짜면 덮어쓴다. 하루에 여러 번 돌려도 마지막 것이 그날의 일지다. */
export function saveDay(record: DayRecord): void {
  try {
    const days = readDays().filter((day) => day.date !== record.date);
    days.push(record);
    days.sort((a, b) => a.date.localeCompare(b.date));
    // 오래된 것부터 버린다. 두 해치면 넉넉하다.
    localStorage.setItem(DAYS, JSON.stringify(days.slice(-800)));
  } catch {
    // 저장이 안 되는 브라우저에서도 도구는 그대로 돌아야 한다.
  }
}

export function removeDay(date: string): void {
  try {
    localStorage.setItem(DAYS, JSON.stringify(readDays().filter((day) => day.date !== date)));
  } catch {
    // 지우지 못해도 도구는 돈다.
  }
}

/**
 * 사람이 고친 일지 문구. 다음 회차부터 이 말로 적는다.
 * 「리셋」을 누르면 지워지고 기본 문구로 돌아간다.
 */
export function readWording(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WORDING);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function learnWordingLocal(patch: Record<string, string>): void {
  if (Object.keys(patch).length === 0) return;
  try {
    localStorage.setItem(WORDING, JSON.stringify({ ...readWording(), ...patch }));
  } catch {
    // 못 적어도 그만이다. 그 회차만 바뀐다.
  }
}

export function forgetWording(): void {
  try {
    localStorage.removeItem(WORDING);
  } catch {
    // 지우지 못해도 도구는 돈다.
  }
}

/**
 * 맛보기 한도를 건너뛰는 열쇠.
 *
 * 주소에 `?pass=…` 를 달고 한 번 열면 이 기기가 기억한다. 주소창은 바로 깨끗해진다.
 * IP 로 열어 주지 않는 까닭은 휴대폰 IP 가 수시로 바뀌기 때문이다.
 */
export function readPass(): string | null {
  try {
    return localStorage.getItem(PASS);
  } catch {
    return null;
  }
}

export function keepPassFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const pass = url.searchParams.get("pass");
    if (pass) {
      localStorage.setItem(PASS, pass);
      url.searchParams.delete("pass");
      window.history.replaceState(null, "", url.toString());
      return pass;
    }
  } catch {
    // 주소를 못 읽어도 도구는 그대로 돈다.
  }
  return readPass();
}

const WORKS = "patrol-jev.works";

/**
 * 자리마다 적는 말을 기억한다.
 *
 * 한 자리만 다른 일을 한 날이 있다. 폐기물을 치운 게 아니라 **경고스티커를 붙인** 자리처럼.
 * 그 자리에서 말을 고치면 두 가지를 기억한다.
 *   ① 그 주소에는 그 말을 쓴다는 것 (다음에 같은 자리가 나오면 그대로 얹는다)
 *   ② 그 말 자체 (다른 자리에서도 골라 쓸 수 있게 목록에 남긴다)
 *
 * 둘 다 이 브라우저에만 쌓인다.
 */
interface Works {
  /** 주소(띄어쓰기 뗀 것) → 그 자리에 적을 말. */
  byPlace: Record<string, string>;
  /** 써 본 말들. 최근에 쓴 것이 앞. */
  phrases: string[];
  /**
   * 말 → 그 말이 들어가는 란. 수동 모드에서 **문구를 고르면 갈래가 따라오게** 하는 표다.
   * 사람이 채울 칸을 둘(자리·말)로 줄이려고 둔다. 모르는 말이면 여기 없고, 그때는 짐작하지 않는다.
   */
  lanes: Record<string, string>;
}

export function readWorks(): Works {
  try {
    const raw = localStorage.getItem(WORKS);
    const parsed = raw ? (JSON.parse(raw) as Partial<Works>) : {};
    return {
      byPlace: parsed.byPlace ?? {},
      phrases: Array.isArray(parsed.phrases) ? parsed.phrases : [],
      // 이 칸이 생기기 전에 쌓인 기록에는 없다. 빈 표로 시작한다.
      lanes: parsed.lanes ?? {},
    };
  } catch {
    return { byPlace: {}, phrases: [], lanes: {} };
  }
}

export function learnWork(address: string, phrase: string, lane?: string): void {
  const key = address.replace(/\s+/g, "");
  const said = phrase.trim();
  try {
    const works = readWorks();
    if (key.length > 0) {
      if (said.length > 0) works.byPlace[key] = said;
      else delete works.byPlace[key];
    }
    if (said.length > 0) {
      works.phrases = [said, ...works.phrases.filter((one) => one !== said)].slice(0, 30);
      // 어느 란에서 쓴 말인지도 같이 적어 둔다. 다음에 그 말을 고르면 란이 따라온다.
      // 「모르겠음」은 적지 않는다. 모른다는 것은 배울 것이 없다는 뜻이다.
      if (lane && lane !== "unknown") works.lanes[said] = lane;
    }
    localStorage.setItem(WORKS, JSON.stringify(works));
  } catch {
    // 못 적어도 그만이다. 그 회차만 기억 못 한다.
  }
}

/** 지금까지 써 본 말과 그 란. 수동 모드의 고르기 목록이 여기서 나온다. */
export function learnedPhrases(works: Works): Array<{ text: string; lane: string }> {
  return works.phrases
    .map((text) => ({ text, lane: works.lanes[text] ?? "" }))
    .filter((one) => one.text.trim().length > 0);
}

/** 이 자리에 대해 기억해 둔 말. 없으면 null. */
export function recallWork(address: string, works: Works): string | null {
  const key = address.replace(/\s+/g, "");
  return key.length > 0 ? (works.byPlace[key] ?? null) : null;
}

export function forgetWorks(): void {
  try {
    localStorage.removeItem(WORKS);
  } catch {
    // 지우지 못해도 도구는 돈다.
  }
}
