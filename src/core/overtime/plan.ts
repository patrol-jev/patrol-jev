/**
 * 초과기록. 오늘 초과 시간을 넣으면 인사랑 「근무기록」에서 칸마다 할 일이 나온다.
 *
 * 이 문서의 판단은 **이 파일 한 곳에만** 있다. 화면(`src/app/overtime/`)은 여기서 나온 값을 그릴 뿐이다.
 * 모델을 부르지 않는다. 같은 입력이면 늘 같은 답이 나온다.
 *
 * 칸과 [확인]은 인사랑 사용 안내(2026-09)를, 시간 셈은 「지방공무원 수당 등에 관한 규정」 제15조를 따른다.
 * 규칙마다 옆에 어디서 왔는지 적어 둔다. 출처에 없는 것은 짐작하지 않고 「기관에 확인」으로 남긴다.
 *
 *   칸      = 정각에서 정각까지 한 시간(18~19, 19~20 …). 19:00 정각은 19~20 칸이다.
 *   기록 칸 = 내 정규 근무시간에 온전히 들어가지 않는 칸. 휴일은 모든 칸.
 *   할 일   = 그 칸 안에 사무실에서 일한 틈이 1분이라도 있으면 [확인], 없으면 미기록 사유.
 *
 * 시각은 하루의 분(0~1440)으로 다룬다. 자정을 넘는 초과는 다루지 않는다.
 */

export type GapKind = "meal" | "away" | "field";

export interface Range {
  from: number;
  to: number;
}

export interface Gap extends Range {
  kind: GapKind;
}

export interface DayInput {
  /** 주말·공휴일. 정규 근무시간이 없고, 모든 칸이 기록 칸이다. */
  holiday: boolean;
  /** 내 정규 근무시간(유연근무면 그 시간). 휴일에는 보지 않는다. */
  base: Range;
  /** 초과 명령(신청)이 걸린 시간. 여러 토막이어도 된다(출근 전, 퇴근 후). */
  spans: Range[];
  /** 자리를 비운 시간. 식사, 개인용무 외출, 현장·외근. */
  gaps: Gap[];
}

export interface Slot {
  hour: number;
  /** 이 칸에서 초과로 걸린 분. */
  minutes: number;
  action: "click" | "reason";
  /** [확인]을 누를 수 있는 틈(사무실에서 일한 시간). 가장 긴 것부터. */
  windows: Range[];
  /** 미기록 사유로 쓸 말(예시). action 이 reason 일 때만. */
  reason: string | null;
  /** 이 칸에서 자리를 비운 까닭들. */
  kinds: GapKind[];
  notes: string[];
}

export interface Plan {
  slots: Slot[];
  /** 근무제외시간으로 넣을 것. 개인용무 외출만. */
  exclusions: Range[];
  overtimeMinutes: number;
  awayMinutes: number;
  mealMinutes: number;
  warnings: string[];
}

export const HOUR = 60;
export const DAY = 24 * HOUR;

/** 알림은 매시 30분쯤 뜬다(사람마다 조금씩 다름). 사용 안내. */
export const NOTICE_FROM = 30;
export const NOTICE_TO = 38;

/** 틈이 이보다 짧으면 누를 새가 없을 수 있다고 알린다. */
const SHORT_WINDOW = 10;

const clampDay = (m: number) => Math.max(0, Math.min(DAY, Math.round(m)));

export function hhmm(minutes: number): string {
  const m = clampDay(minutes);
  return `${String(Math.floor(m / HOUR)).padStart(2, "0")}:${String(m % HOUR).padStart(2, "0")}`;
}

/** "18:30" → 1110. 못 읽으면 null. "24:00" 까지 받는다. */
export function parseHhmm(text: string): number | null {
  const hit = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text);
  if (!hit) return null;
  const h = Number(hit[1]);
  const m = Number(hit[2]);
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * HOUR + m;
}

/** 칸 이름. 18 → "18~19시". */
export function slotLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}~${String(hour + 1).padStart(2, "0")}시`;
}

/** 겹치는 토막을 합치고 시각 순으로 늘어놓는다. 길이 0 은 버린다. */
export function merge(ranges: Range[]): Range[] {
  const sorted = ranges
    .map((r) => ({ from: clampDay(r.from), to: clampDay(r.to) }))
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

function intersect(a: Range[], b: Range): Range[] {
  const out: Range[] = [];
  for (const r of a) {
    const from = Math.max(r.from, b.from);
    const to = Math.min(r.to, b.to);
    if (to > from) out.push({ from, to });
  }
  return out;
}

function subtract(a: Range[], cut: Range[]): Range[] {
  let rest = merge(a);
  for (const c of merge(cut)) {
    const next: Range[] = [];
    for (const r of rest) {
      if (c.to <= r.from || c.from >= r.to) {
        next.push(r);
        continue;
      }
      if (c.from > r.from) next.push({ from: r.from, to: c.from });
      if (c.to < r.to) next.push({ from: c.to, to: r.to });
    }
    rest = next;
  }
  return rest;
}

const total = (ranges: Range[]) => ranges.reduce((sum, r) => sum + (r.to - r.from), 0);

/**
 * 이 칸이 기록 칸인가.
 * 정규 근무시간에 온전히 들어가는 칸만 빠진다. 09:30~18:30 근무면 09~10 칸과 18~19 칸은 기록 칸이다(사용 안내, 유연근무).
 */
export function isRecordHour(hour: number, input: Pick<DayInput, "holiday" | "base">): boolean {
  if (input.holiday) return true;
  return !(input.base.from <= hour * HOUR && (hour + 1) * HOUR <= input.base.to);
}

function mealWord(hour: number): string {
  if (hour < 10) return "아침 식사";
  if (hour >= 11 && hour < 15) return "점심 식사";
  return "저녁 식사";
}

const REASON: Record<Exclude<GapKind, "meal">, string> = {
  away: "개인용무(외출)",
  field: "현장근무(무슨 일인지 적기)",
};

export function planDay(input: DayInput): Plan {
  const warnings: string[] = [];

  // 초과 시간. 평일에는 정규 근무시간 안쪽을 뺀다. 그 시간은 초과가 아니다.
  let overtime = merge(input.spans);
  if (!input.holiday) {
    const inside = intersect(overtime, input.base);
    if (inside.length > 0) {
      warnings.push(
        `정규 근무시간(${hhmm(input.base.from)}~${hhmm(input.base.to)}) 안쪽 ${total(inside)}분은 초과가 아니라서 뺐습니다.`,
      );
      overtime = subtract(overtime, [input.base]);
    }
  }

  const gaps = input.gaps
    .map((g) => ({ ...g, from: clampDay(g.from), to: clampDay(g.to) }))
    .filter((g) => g.to > g.from);
  const outside = gaps.filter((g) => intersect(overtime, g).length === 0);
  if (outside.length > 0) {
    warnings.push("초과 시간 밖에 적은 비운 시간은 셈에 넣지 않았습니다.");
  }

  const slots: Slot[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const cell: Range = { from: hour * HOUR, to: (hour + 1) * HOUR };
    if (!isRecordHour(hour, input)) continue;
    const here = intersect(overtime, cell);
    const minutes = total(here);
    if (minutes === 0) continue;

    const touching = gaps.filter((g) => intersect(here, g).length > 0);
    const windows = subtract(here, touching).sort((a, b) => b.to - b.from - (a.to - a.from));
    const kinds = [...new Set(touching.map((g) => g.kind))];
    const notes: string[] = [];

    if (windows.length > 0) {
      const longest = windows[0].to - windows[0].from;
      if (longest < SHORT_WINDOW) {
        notes.push(`누를 틈이 ${longest}분뿐입니다. 놓치면 이 칸은 미기록 사유를 씁니다.`);
      }
      if (kinds.includes("away")) notes.push("외출한 시간은 근무제외시간으로도 넣습니다.");
      slots.push({ hour, minutes, action: "click", windows, reason: null, kinds, notes });
      continue;
    }

    // 칸 전체를 비웠다. 가장 오래 비운 까닭으로 사유를 쓴다.
    const byKind = new Map<GapKind, number>();
    for (const g of touching) byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + total(intersect(here, g)));
    const main = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const reason = main === "meal" ? mealWord(hour) : REASON[main];
    if (main === "away") notes.push("근무제외시간에도 넣습니다.");
    slots.push({ hour, minutes, action: "reason", windows: [], reason, kinds, notes });
  }

  const inOvertime = (kind: GapKind) =>
    merge(gaps.filter((g) => g.kind === kind).flatMap((g) => intersect(overtime, g)));

  const exclusions = inOvertime("away");
  const meals = inOvertime("meal");
  const mealSlots = slots.filter((s) => s.action === "reason" && s.kinds.includes("meal")).length;
  // 1시간 공제는 평일 이야기다(규정 제15조제5항제2호: 공휴일·토요일은 빼지 않는다).
  if (!input.holiday && (total(meals) > HOUR || mealSlots > 1)) {
    warnings.push("평일은 하루 1시간을 뺍니다(규정 제15조제5항). 1시간을 넘게 비웠다면 넘는 만큼은 외출로 적는 것이 맞는지 확인하세요.");
  }

  // 그날 시간외근무가 1시간 미만이면 월 셈에 더하지 않는다(규정 제15조제5항제2호 단서).
  const worked = total(overtime) - total(exclusions);
  if (worked > 0 && worked < HOUR) {
    warnings.push("그날 초과가 1시간이 안 되면 월 셈에 더하지 않습니다(규정 제15조제5항).");
  }

  if (slots.length === 0 && merge(input.spans).length > 0) {
    warnings.push("기록할 칸이 없습니다. 초과 시간이 정규 근무시간 안에 있는지 보세요.");
  }

  return {
    slots,
    exclusions,
    overtimeMinutes: total(overtime),
    awayMinutes: total(exclusions),
    mealMinutes: total(meals),
    warnings,
  };
}

/** [확인] 알림을 울릴 시각. 알림이 뜨는 매시 30분쯤을 먼저 고르고, 그때 자리에 없으면 가장 긴 틈의 가운데. */
export function nudgeAt(slot: Slot): number | null {
  if (slot.action !== "click" || slot.windows.length === 0) return null;
  const want = slot.hour * HOUR + NOTICE_FROM;
  const hit = slot.windows.find((w) => w.from <= want && want < w.to);
  if (hit) return want;
  const w = slot.windows[0];
  return w.from + Math.floor((w.to - w.from) / 2);
}

/** 분을 "3시간 20분" 꼴로. */
export function spell(minutes: number): string {
  const h = Math.floor(minutes / HOUR);
  const m = minutes % HOUR;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

/** 날짜가 토·일인가. "2026-10-03" 꼴. 공휴일은 모른다(사람이 켠다). */
export function isWeekend(date: string): boolean {
  const d = new Date(`${date}T12:00:00+09:00`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** 날짜와 그날의 분을 실제 시각(ms)으로. 한국 시각은 서머타임이 없어 UTC+9 로 고정한다. */
export function kstAt(date: string, minutes: number): number {
  const [y, mo, d] = date.split("-").map(Number);
  return Date.UTC(y, mo - 1, d) + (minutes - 9 * HOUR) * 60_000;
}

/** 지금 한국 날짜. "2026-10-01" 꼴. */
export function kstToday(now: number = Date.now()): string {
  return new Date(now + 9 * HOUR * 60_000).toISOString().slice(0, 10);
}

/** 다음 날. */
export function nextDate(date: string): string {
  return kstToday(kstAt(date, 12 * HOUR) + DAY * 60_000);
}


/** "2026-10-01" → "10/1(목)". */
export function dayLabel(date: string): string {
  const [, mo, d] = date.split("-").map(Number);
  const w = "일월화수목금토"[new Date(kstAt(date, 12 * HOUR)).getUTCDay()];
  return `${mo}/${d}(${w})`;
}

/**
 * 사람이 친 시각을 "HH:MM" 로. 콜론 없이 숫자만 쳐도 된다. 못 읽으면 null.
 *   "18" → 18:00 · "6" → 06:00 · "930" → 09:30 · "1830" → 18:30 · "18:3" → 18:03 · "24" → 24:00
 */
export function readTyped(text: string): string | null {
  const s = text.trim().replace(/[.．：]/g, ":").replace(/\s+/g, "");
  let h: number;
  let m: number;
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    m = 0;
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, s.length - 2));
    m = Number(s.slice(-2));
  } else {
    return null;
  }
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return hhmm(h * HOUR + m);
}
