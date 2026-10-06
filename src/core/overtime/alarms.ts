/**
 * 초과기록 알림 목록. 남긴 날(`DayNote`)로 언제 무엇을 울릴지 정하고, 알림 단추로 받은 답을 날마다의 기록에 합친다.
 *
 * 판단은 여기 한 곳에만 있다. 웹 푸시(`push.ts`)와 아이폰 앱(`ios/Patrol/Alarm/AlarmCenter.swift`)은 이 목록을 울릴 뿐이다.
 * 같은 기록이면 늘 같은 목록이 나온다.
 *
 *   토막    = 기록 칸이 이어진 덩어리. 출근 전 06~09시와 퇴근 뒤 18~21시는 서로 다른 토막이다.
 *   묻기    = 토막이 시작하기 10분 전(휴일 첫 토막은 30분 전) 「남으세요?」. 답이 없으면 칸 알림은 그대로 울린다.
 *   받는 때 = 사람이 정한 알림 받는 시간(기본 하루 종일). 그 밖의 칸 · 요약은 울리지 않고, 묻기 · 다음 날은 받는 시간
 *             시작으로 미룬다. 사전신청을 넉넉히 올려 두어도 자는 새벽에 울리지 않게 하려는 것이다.
 *   칸      = [확인] 칸마다 `nudgeAt` 시각. 「눌렀어요」 한 칸, 「안 남아요」 한 토막, 「오늘은 끝났어요」 뒤 칸, 지운 칸은 울리지 않는다.
 *   한 번 더 = 칸 알림 뒤에도 「눌렀어요」가 없으면 정각 10분 전(매시 50분)에 한 번 더. 글 앞에 🟠 를 달아 첫 알림과 다르게 보인다.
 *             그 칸에서 누를 틈이 50분 전에 끝나면 울리지 않는다.
 *   지운 칸 = 사전신청은 걸렸는데 남지 않은 칸. 다음 날 「못 누른 칸(사유)」과 「안 남은 칸」을 가르려고 남긴다.
 *   요약    = 마지막으로 남은 토막이 끝나고 10분 뒤. 「오늘은 끝났어요」를 누른 날은 없다.
 *   다음 날 = 09:10 확인자료(지금과 같음). 「올렸어요」를 누르면 그날이 닫힌다.
 *
 * 앱의 알림 단추는 사람이 스스로 적는 메모일 뿐이다. 인사랑에 아무것도 보내지 않는다.
 */

import { DAY_NUDGE, HOUR, kstAt, nextDate, type GapKind, type Range } from "./plan";

/** 화면에 넣은 값(글자 그대로). 남긴 날을 다시 열 때 되살린다. 알림 셈에는 쓰지 않고, 이 기기 밖으로 나가지 않는다. */
export interface DayForm {
  base: { from: string; to: string };
  spans: Array<{ from: string; to: string }>;
  gaps: Array<{ kind: GapKind; from: string; to: string }>;
}

/** 하루에 남기는 것. 화면이 「이 날 초과로 남기기」를 누를 때 만들고, 알림 단추의 답을 여기에 합친다. */
export interface DayNote {
  /** [확인] 칸. `end` = 그 칸에서 누를 틈이 끝나는 때(그날의 분). 옛 기록에는 없다(칸 끝으로 본다). */
  clicks: Array<{ hour: number; at: number; end?: number }>;
  reasons: Array<{ hour: number; reason: string }>;
  exclusions: Range[];
  done: boolean;
  /** 휴일이면 첫 묻기를 더 일찍 한다. */
  holiday?: boolean;
  /** 「눌렀어요」 한 칸(시). */
  pressed?: number[];
  /** 「못 눌렀어요」 한 칸(시). 다음 날 사유 쓸 칸에 더해 보인다. */
  missed?: number[];
  /** 「남아요」 한 토막(첫 칸의 시). */
  stay?: number[];
  /** 「안 남아요」 한 토막(첫 칸의 시). */
  left?: number[];
  /** 「오늘은 끝났어요」를 누른 때(그날의 분). */
  endedAt?: number;
  /** 지운 칸(시). 사전신청만 걸리고 남지 않은 칸. 알림이 울리지 않고, 다음 날 사유 쓸 칸에서 빠진다. */
  cut?: number[];
  form?: DayForm;
}

export type AlarmJob =
  | { at: number; kind: "slot"; hour: number; date: string; again?: true }
  | { at: number; kind: "day"; date: string }
  | { at: number; kind: "ask"; date: string; hour: number; until: number }
  | { at: number; kind: "sum"; date: string; clicks: number; reasons: number; pressed: number[] };

/** 알림 단추로 받은 답. 앱이 쌓아 두었다가 화면이 열릴 때 넘긴다. */
export type AlarmEvent =
  | { op: "done" | "missed"; date: string; hour: number }
  | { op: "stay" | "leave"; date: string; hour: number }
  | { op: "end"; date: string; minute: number }
  | { op: "uploaded"; date: string };

/** 묻는 때. 토막 시작 몇 분 전. */
export const ASK_BEFORE = 10;
export const ASK_BEFORE_HOLIDAY = 30;

/** 사람이 고르는 알림 설정. 이 기기에만 남는다. */
export interface AlarmPrefs {
  /** 알림 받는 시간(그날의 분). from 이상 to 미만에만 울린다. */
  from: number;
  to: number;
  /** 「남으세요?」를 토막 시작 몇 분 전에 묻나. 0 이면 시작할 때. 휴일 첫 토막은 이보다 이르면 30분 전. */
  askBefore: number;
  /** false 면 소리 · 진동 없이 뜨기만 한다(앱). */
  sound: boolean;
}

export const DEFAULT_PREFS: AlarmPrefs = { from: 0, to: 24 * HOUR, askBefore: ASK_BEFORE, sound: true };

/** 저장된 값을 읽는다. 틀린 값은 기본으로. */
export function readPrefs(value: unknown): AlarmPrefs {
  if (!value || typeof value !== "object") return DEFAULT_PREFS;
  const v = value as Partial<Record<keyof AlarmPrefs, unknown>>;
  const minute = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 24 * HOUR;
  const range = minute(v.from) && minute(v.to) && (v.from as number) < (v.to as number);
  return {
    from: range ? (v.from as number) : DEFAULT_PREFS.from,
    to: range ? (v.to as number) : DEFAULT_PREFS.to,
    askBefore: Number.isInteger(v.askBefore) && (v.askBefore as number) >= 0 && (v.askBefore as number) <= 120 ? (v.askBefore as number) : ASK_BEFORE,
    sound: typeof v.sound === "boolean" ? v.sound : true,
  };
}
/** 요약은 토막이 끝나고 몇 분 뒤. */
export const SUM_AFTER = 10;
/** 한 번 더 알림은 매시 몇 분에(정각 10분 전). */
export const AGAIN_AT = 50;

export interface Segment {
  /** 첫 칸의 시. */
  first: number;
  /** 끝(마지막 칸의 다음 시). */
  until: number;
}

/** 기록 칸(시)을 이어진 덩어리로 묶는다. */
export function segmentsOf(note: Pick<DayNote, "clicks" | "reasons">): Segment[] {
  const hours = [...new Set([...note.clicks.map((c) => c.hour), ...note.reasons.map((r) => r.hour)])].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (const h of hours) {
    const last = out[out.length - 1];
    if (last && last.until === h) last.until = h + 1;
    else out.push({ first: h, until: h + 1 });
  }
  return out;
}

/**
 * 알림이 울리지 않는 칸(시). 「안 남아요」 한 토막 · 「끝났어요」 뒤 칸 · 지운 칸.
 * 「안 남아요」는 묻기를 받은 칸(토막의 첫 살아 있는 칸)으로 오므로 토막 안의 어느 시든 그 토막 전체를 끈다.
 */
export function offHoursOf(note: DayNote): Set<number> {
  const off = new Set<number>(note.cut ?? []);
  for (const seg of segmentsOf(note)) {
    const left = (note.left ?? []).some((h) => h >= seg.first && h < seg.until);
    for (let h = seg.first; h < seg.until; h++) {
      if (left || (note.endedAt !== undefined && h * HOUR >= note.endedAt)) off.add(h);
    }
  }
  return off;
}

/** 맡길 알림. 아직 안 지난 것만, 시각 순으로. */
export function jobsOf(days: Record<string, DayNote>, now: number, prefs: AlarmPrefs = DEFAULT_PREFS): AlarmJob[] {
  const jobs: AlarmJob[] = [];
  const push = (job: AlarmJob) => {
    if (job.at > now) jobs.push(job);
  };
  const inside = (minute: number) => minute >= prefs.from && minute < prefs.to;

  for (const [date, note] of Object.entries(days)) {
    if (note.done) continue;
    const segments = segmentsOf(note);
    const off = offHoursOf(note);
    // 토막마다 아직 울릴 칸. 다 꺼졌거나 지운 토막, 받는 시간과 한 칸도 안 겹치는 토막은 통째로 조용히 둔다.
    const live = segments
      .map((seg) => {
        const hours: number[] = [];
        for (let h = seg.first; h < seg.until; h++) if (!off.has(h)) hours.push(h);
        return { seg, hours };
      })
      .filter(({ seg, hours }) => hours.length > 0 && seg.until * HOUR > prefs.from && seg.first * HOUR < prefs.to);

    live.forEach(({ seg, hours }) => {
      const first = hours[0];
      if (!note.stay?.some((h) => h >= seg.first && h < seg.until)) {
        const before = note.holiday && seg === segments[0] ? Math.max(prefs.askBefore, ASK_BEFORE_HOLIDAY) : prefs.askBefore;
        // 받는 시간 전이면 받는 시간 시작으로 미룬다. 토막이 그 전에 끝나면 묻지 않는다.
        // 앞 칸을 지웠으면 남은 첫 칸 앞에서 묻는다.
        const ask = Math.max(first * HOUR - before, prefs.from);
        if (ask < seg.until * HOUR && ask < prefs.to) {
          push({ at: kstAt(date, ask), kind: "ask", date, hour: first, until: seg.until });
        }
      }
      for (const c of note.clicks) {
        if (!hours.includes(c.hour)) continue;
        if (note.pressed?.includes(c.hour)) continue;
        if (note.endedAt !== undefined && c.at >= note.endedAt) continue;
        if (inside(c.at)) push({ at: kstAt(date, c.at), kind: "slot", hour: c.hour, date });
        // 그래도 안 눌렀으면 정각 10분 전에 한 번 더. 누를 틈이 그 전에 끝나면 없다.
        const again = c.hour * HOUR + AGAIN_AT;
        const until = c.end ?? (c.hour + 1) * HOUR;
        if (again > c.at && again < until && inside(again) && (note.endedAt === undefined || again < note.endedAt)) {
          push({ at: kstAt(date, again), kind: "slot", hour: c.hour, date, again: true });
        }
      }
    });

    const end = live.length > 0 ? (live[live.length - 1].hours.slice(-1)[0] + 1) * HOUR + SUM_AFTER : -1;
    // 받는 시간이 하루 끝까지면 자정 넘어 10분 요약도 보낸다.
    if (live.length > 0 && note.endedAt === undefined && (inside(end) || (prefs.to === 24 * HOUR && end >= prefs.from))) {
      push({
        at: kstAt(date, end),
        kind: "sum",
        date,
        clicks: note.clicks.filter((c) => !note.cut?.includes(c.hour)).length,
        reasons: note.reasons.filter((r) => !note.cut?.includes(r.hour)).length,
        pressed: [...(note.pressed ?? [])].sort((a, b) => a - b),
      });
    }

    // 다음 날 09:10. 받는 시간 밖이면 받는 시간 안쪽 가장 가까운 때로.
    push({ at: kstAt(nextDate(date), Math.min(Math.max(DAY_NUDGE, prefs.from), prefs.to - 1)), kind: "day", date });
  }
  return jobs.sort((a, b) => a.at - b.at);
}

const add = (list: number[] | undefined, value: number) => [...new Set([...(list ?? []), value])].sort((a, b) => a - b);
const drop = (list: number[] | undefined, value: number) => (list ?? []).filter((v) => v !== value);

/** 알림 단추의 답을 기록에 합친다. 남기지 않은 날의 답은 버린다. 같은 답을 두 번 받아도 같다. */
export function applyEvents(days: Record<string, DayNote>, events: AlarmEvent[]): Record<string, DayNote> {
  const next: Record<string, DayNote> = { ...days };
  for (const e of events) {
    const note = next[e.date];
    if (!note) continue;
    switch (e.op) {
      case "done":
        next[e.date] = { ...note, pressed: add(note.pressed, e.hour), missed: drop(note.missed, e.hour) };
        break;
      case "missed":
        next[e.date] = { ...note, missed: add(note.missed, e.hour), pressed: drop(note.pressed, e.hour) };
        break;
      case "stay":
        next[e.date] = { ...note, stay: add(note.stay, e.hour), left: drop(note.left, e.hour) };
        break;
      case "leave":
        next[e.date] = { ...note, left: add(note.left, e.hour), stay: drop(note.stay, e.hour) };
        break;
      case "end":
        next[e.date] = { ...note, endedAt: note.endedAt === undefined ? e.minute : Math.min(note.endedAt, e.minute) };
        break;
      case "uploaded":
        next[e.date] = { ...note, done: true };
        break;
    }
  }
  return next;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isHour = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 24;

/** 앱이 넘긴 답을 읽는다. 틀린 줄은 버린다. */
export function readEvents(value: unknown): AlarmEvent[] {
  if (!Array.isArray(value)) return [];
  const out: AlarmEvent[] = [];
  for (const raw of value.slice(0, 500)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as { op?: unknown; date?: unknown; hour?: unknown; minute?: unknown };
    if (typeof e.date !== "string" || !DATE.test(e.date)) continue;
    if ((e.op === "done" || e.op === "missed" || e.op === "stay" || e.op === "leave") && isHour(e.hour)) {
      out.push({ op: e.op, date: e.date, hour: e.hour });
    } else if (e.op === "end" && Number.isInteger(e.minute) && (e.minute as number) >= 0 && (e.minute as number) <= 24 * HOUR) {
      out.push({ op: "end", date: e.date, minute: e.minute as number });
    } else if (e.op === "uploaded") {
      out.push({ op: "uploaded", date: e.date });
    }
  }
  return out;
}
