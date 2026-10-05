/**
 * 초과기록 무대의 말풍선. PJ 가 지금 사람에게 건넬 말 한 마디를 고른다.
 *
 * 모델을 부르지 않는다. 상태(남긴 날 · 지금 시각 · 알림)마다 정해 둔 문장 가운데 하나를, 위에서부터 먼저 맞는 것으로 고른다.
 * 같은 상태면 늘 같은 말이다. 화면은 이 값을 그리기만 한다.
 *
 *   1. 지난 날 확인자료가 남았다     → 「올릴 차례예요」 + 올렸어요
 *   2. 오늘 남긴 날                   → 끝냈다 · 지금 칸 · 다음 칸 · 다 지났다
 *   3. 고른 날이 있다                 → 남김(앞날) · 셈 결과 · 시간 넣기
 *   4. 아무것도 없다                  → 기본 안내
 *
 * 말투는 「~예요 / ~할게요」, 짧게. 권하는 말은 하되 「일했는지」 판정하는 말은 하지 않는다. 긴 줄표를 쓰지 않는다.
 */

import { DEFAULT_PREFS, jobsOf, segmentsOf, type AlarmPrefs, type DayNote } from "./alarms";
import { dayLabel, HOUR, hhmm, kstAt, kstToday, nextDate, slotLabel } from "./plan";

export interface TalkInput {
  now: number;
  /** 남긴 날들(화면이 들고 있는 그대로). */
  days: Record<string, DayNote>;
  /** 아래 칸에서 고른 날. 아직 안 골랐으면 null. */
  date: string | null;
  /** 고른 날이 아직 안 남긴 날이면 그 셈. [확인] 칸 수 · 사유 칸 수. */
  draft: { clicks: number; reasons: number } | null;
  /** 알림이 켜져 있나. */
  alarm: boolean;
  /** 앱 안인가(「남으세요?」를 묻는다). */
  native: boolean;
  prefs?: AlarmPrefs;
}

export interface Line {
  text: string;
  /** 한 줄 더(작게). */
  sub?: string;
  /** 「올렸어요」 단추. 그 날짜. */
  uploaded?: string;
  /** 「눌렀어요」 단추. 오늘의 그 칸(시). */
  press?: number;
  /** 알림이 꺼져 있어 켜자고 권한다. 화면은 이 말(`ALARM_OFF`)을 눌러서 켜는 라벨로 그린다. */
  offer?: "alarm";
}

/** 기본 안내. 아무것도 안 남겼을 때. 화면은 문장마다 한 줄씩 차례로 친다(`sentencesOf`). */
export const BASIC =
  "초과가 걸린 시간에는 한 시간 칸마다 인사랑 [근무기록] → [확인]을 한 번 눌러요. 지문과 퇴근확인은 그대로 따로 해요. 못 누른 칸은 미기록 사유를 쓰고, 확인자료는 다음 날 날짜별로 한 건씩 올려요.";

/** 알림을 켜자는 말. 화면에서는 눌러서 바로 켜는 라벨이다. */
export const ALARM_OFF = "알림을 켜 두면 칸마다 제가 챙길게요.";

/** 말을 문장으로 나눈다. 마침표 · 물음표 뒤의 빈칸에서 끊는다. 「10/6(화)」 같은 날짜의 점은 끊지 않는다. */
export function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/).filter((part) => part.length > 0);
}

const range = (first: number, until: number) => `${hhmm(first * HOUR)}~${hhmm(until * HOUR)}`;

export function lineOf(input: TalkInput): Line {
  const { now, days, date, draft, alarm, native } = input;
  const prefs = input.prefs ?? DEFAULT_PREFS;
  const today = kstToday(now);

  // 1. 지난 날 확인자료. 가장 오래된 날부터 하나씩.
  const pending = Object.keys(days)
    .filter((d) => d < today && !days[d].done)
    .sort();
  if (pending.length > 0) {
    const d = pending[0];
    const note = days[d];
    const when = nextDate(d) === today ? `어제 ${dayLabel(d)}` : dayLabel(d);
    const hours = [...new Set([...note.reasons.map((r) => r.hour), ...(note.missed ?? [])])].sort((a, b) => a - b);
    const sub =
      hours.length === 0
        ? "다 눌렀어도 날짜별로 한 건 올려요."
        : hours.length === 1
          ? `사유 쓸 칸은 ${slotLabel(hours[0])} 하나예요.`
          : `사유 쓸 칸은 ${hours.map(slotLabel).join(", ")} 모두 ${hours.length}칸이에요.`;
    const off = note.exclusions.length > 0 ? ` 근무제외시간 ${note.exclusions.map((r) => `${hhmm(r.from)}~${hhmm(r.to)}`).join(", ")}도 넣어요.` : "";
    const more = pending.length > 1 ? ` 이런 날이 ${pending.length}일 남았어요.` : "";
    return { text: `${when} 초과 확인자료 올릴 차례예요.${more}`, sub: sub + off, uploaded: d };
  }

  // 2. 오늘 남긴 날.
  const note = days[today];
  if (note && !note.done && (date === null || date === today)) {
    const minute = Math.floor((now - kstAt(today, 0)) / 60_000);
    const segments = segmentsOf(note);
    const live = segments.filter((s) => !note.left?.includes(s.first));
    const ended = note.endedAt !== undefined && minute >= note.endedAt;
    const ahead = live.filter((s) => s.until * HOUR > minute);

    if (ended || (segments.length > 0 && live.length === 0) || (ahead.length === 0 && live.length < segments.length)) {
      return { text: "오늘은 여기까지예요. 나머지 칸은 안 울릴게요.", sub: "내일 아침에 확인자료 올릴 차례를 알려 드릴게요." };
    }

    const hour = Math.floor(minute / HOUR);
    const inNow = live.some((s) => s.first <= hour && hour < s.until);
    if (inNow) {
      const click = note.clicks.find((c) => c.hour === hour);
      const reason = note.reasons.find((r) => r.hour === hour);
      if (click && !note.pressed?.includes(hour)) {
        const text =
          minute < click.at
            ? `지금 ${slotLabel(hour)} 칸이에요. ${hhmm(click.at)}쯤 [확인] 눌러 주세요.`
            : `지금 ${slotLabel(hour)} 칸이에요. [확인] 눌러 주세요.`;
        return { text, sub: "누르셨으면 아래 단추로 알려 주세요. 그 칸 알림은 멈출게요.", press: hour };
      }
      if (click) {
        const next = note.clicks.find((c) => c.hour > hour && !note.pressed?.includes(c.hour) && live.some((s) => s.first <= c.hour && c.hour < s.until));
        return next
          ? { text: `${slotLabel(hour)} 칸은 눌렀어요. 다음 ${slotLabel(next.hour)} 칸에 또 알려 드릴게요.` }
          : { text: `${slotLabel(hour)} 칸까지 눌렀어요. 오늘 누를 칸은 이게 마지막이에요.` };
      }
      if (reason) {
        return { text: `지금 ${slotLabel(hour)} 칸은 [확인] 대신 사유를 쓰는 칸이에요.`, sub: `내일 미기록 사유에 「${reason.reason}」라고 적어요.` };
      }
    }

    if (ahead.length > 0) {
      const ranges = ahead.map((s) => range(Math.max(s.first, hour), s.until)).join(", ");
      const started = live.some((s) => s.first * HOUR <= minute);
      const text = `오늘 ${started ? "남은 초과는" : "초과"} ${ranges} 걸려 있어요.`;
      if (!alarm) return { text, offer: "alarm" };
      // 웹 알림에는 「남으세요?」가 없다. 앱이 아니면 첫 칸 알림만 본다.
      const job = jobsOf({ [today]: note }, now, prefs).find((j) => j.kind === "slot" || (native && j.kind === "ask"));
      if (job?.kind === "ask") return { text, sub: `${hhmm(minuteOf(job.at, today))}에 남으실지 여쭤볼게요.` };
      if (job?.kind === "slot") return { text, sub: `${hhmm(minuteOf(job.at, today))}쯤 [확인] 알림을 드릴게요.` };
      return { text, sub: "칸마다 알려 드릴게요." };
    }

    return {
      text: "오늘 칸은 다 지났어요. 수고하셨어요.",
      sub: alarm ? "내일 아침에 확인자료 올릴 차례를 알려 드릴게요." : "내일 이 화면을 열면 확인자료 차례를 알려 드릴게요.",
    };
  }

  // 3. 고른 날.
  if (date !== null) {
    const kept = days[date];
    if (kept && !kept.done) {
      return { text: `${dayLabel(date)} 초과를 남겼어요. 그날 칸마다 챙길게요.`, offer: alarm ? undefined : "alarm" };
    }
    if (kept?.done) return { text: `${dayLabel(date)}은 확인자료까지 올린 날이에요.` };
    const total = draft ? draft.clicks + draft.reasons : 0;
    if (!draft || total === 0) return { text: `${dayLabel(date)} 초과 시간을 넣어 주세요.`, sub: "누를 칸을 바로 셈해 드려요." };
    return {
      text: `${total}칸이에요. [확인] ${draft.clicks}칸, 사유 ${draft.reasons}칸.`,
      sub: "맞으면 맨 아래 「남기기」를 눌러 주세요.",
    };
  }

  // 4. 처음.
  return { text: BASIC, sub: "날짜부터 골라 주세요." };
}

const minuteOf = (at: number, date: string) => Math.round((at - kstAt(date, 0)) / 60_000);
