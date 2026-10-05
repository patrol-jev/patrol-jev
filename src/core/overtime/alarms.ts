/**
 * 초과기록 알림 목록. 남긴 날(`DayNote`)로 언제 무엇을 울릴지 정하고, 알림 단추로 받은 답을 날마다의 기록에 합친다.
 *
 * 판단은 여기 한 곳에만 있다. 웹 푸시(`push.ts`)와 아이폰 앱(`ios/Patrol/Alarm/AlarmCenter.swift`)은 이 목록을 울릴 뿐이다.
 * 같은 기록이면 늘 같은 목록이 나온다.
 *
 *   토막    = 기록 칸이 이어진 덩어리. 출근 전 06~09시와 퇴근 뒤 18~21시는 서로 다른 토막이다.
 *   묻기    = 토막이 시작하기 10분 전(휴일 첫 토막은 30분 전) 「남으세요?」. 답이 없으면 칸 알림은 그대로 울린다.
 *   칸      = [확인] 칸마다 `nudgeAt` 시각. 「눌렀어요」 한 칸, 「안 남아요」 한 토막, 「오늘은 끝났어요」 뒤 칸은 울리지 않는다.
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
  clicks: Array<{ hour: number; at: number }>;
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
  form?: DayForm;
}

export type AlarmJob =
  | { at: number; kind: "slot"; hour: number; date: string }
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
/** 요약은 토막이 끝나고 몇 분 뒤. */
export const SUM_AFTER = 10;

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

/** 이 토막이 아직 살아 있나(「안 남아요」도, 「끝났어요」 뒤도 아님). */
function alive(note: DayNote, seg: Segment): boolean {
  if (note.left?.includes(seg.first)) return false;
  if (note.endedAt !== undefined && seg.first * HOUR >= note.endedAt) return false;
  return true;
}

/** 맡길 알림. 아직 안 지난 것만, 시각 순으로. */
export function jobsOf(days: Record<string, DayNote>, now: number): AlarmJob[] {
  const jobs: AlarmJob[] = [];
  const push = (job: AlarmJob) => {
    if (job.at > now) jobs.push(job);
  };

  for (const [date, note] of Object.entries(days)) {
    if (note.done) continue;
    const segments = segmentsOf(note);
    const live = segments.filter((s) => alive(note, s));

    live.forEach((seg) => {
      if (!note.stay?.includes(seg.first)) {
        const before = note.holiday && seg === segments[0] ? ASK_BEFORE_HOLIDAY : ASK_BEFORE;
        push({ at: kstAt(date, seg.first * HOUR - before), kind: "ask", date, hour: seg.first, until: seg.until });
      }
      for (const c of note.clicks) {
        if (c.hour < seg.first || c.hour >= seg.until) continue;
        if (note.pressed?.includes(c.hour)) continue;
        if (note.endedAt !== undefined && c.at >= note.endedAt) continue;
        push({ at: kstAt(date, c.at), kind: "slot", hour: c.hour, date });
      }
    });

    if (live.length > 0 && note.endedAt === undefined) {
      const end = live[live.length - 1].until * HOUR + SUM_AFTER;
      push({
        at: kstAt(date, end),
        kind: "sum",
        date,
        clicks: note.clicks.length,
        reasons: note.reasons.length,
        pressed: [...(note.pressed ?? [])].sort((a, b) => a - b),
      });
    }

    push({ at: kstAt(nextDate(date), DAY_NUDGE), kind: "day", date });
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
