"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { applyEvents, DEFAULT_PREFS, jobsOf, offHoursOf, readPrefs, type AlarmPrefs, type DayForm, type DayNote } from "@/core/overtime/alarms";
import { FAQ, SOURCES } from "@/core/overtime/faq";
import {
  dayLabel,
  hhmm,
  kstAt,
  kstToday,
  nextDate,
  nudgeAt,
  parseHhmm,
  planDay,
  readTyped,
  slotLabel,
  spell,
  type Gap,
  type GapKind,
  type Plan,
  type Range,
} from "@/core/overtime/plan";
import { answer, EXAMPLES, QUESTION_EXAMPLES, replyTo, stepLine, stepReply, STEPS, type Proposal } from "@/core/overtime/chat";
import { holidayLabel, isHoliday } from "@/core/overtime/holidays";
import { ALARM_OFF, END_SUB, END_TEXT, lineOf, sentencesOf, type Line } from "@/core/overtime/talk";
import { OvertimeClockMark } from "@/ui/overtime-mark";
import { isNativeAlarm, newDeviceId, pushReady, subscribe, syncJobs, takeEvents, unsubscribe, type PushReady } from "./push-client";
import "./overtime.css";

/**
 * 초과기록. 오늘 초과 시간을 넣으면 인사랑 「근무기록」에서 칸마다 할 일이 나온다.
 *
 * 판단은 `src/core/overtime/plan.ts` 한 곳에 있고, 이 화면은 그 값을 그릴 뿐이다.
 * 넣은 값(근무시간, 초과 시간, 비운 때, 날마다 할 일)은 이 기기에만 남는다.
 * 진동 알림을 켠 기기만 **울릴 시각과 칸 번호·날짜**를 서버에 맡긴다(`push-client.ts`).
 *
 * 첫 화면은 무대 하나다(사진일지와 같은 짜임). 위 칸은 PJ 의 말풍선이고(`src/core/overtime/talk.ts` 가 고른 한 마디),
 * 가운데에 연보라 시계 사진기(`src/ui/overtime-mark.tsx`), 아래 칸은 날짜(오늘 · 내일 · 다른 날)뿐이다.
 * 날짜를 고르면 그 아래로 초과 시간 · 칸 목록 · 남기기가 열린다. 근무시간과 자리 비운 때는 접어 두고 필요할 때 연다.
 *
 * 다음 날 이 화면을 열면 말풍선이 전날 초과의 확인자료를 올릴 차례라고 말한다.
 * 「올렸어요」를 누르면 그날 알림이 함께 사라지고, 남은 날이 있으면 다음 날 것을 말한다.
 *
 * 무엇을 언제 울릴지(묻기 · 칸 · 요약 · 다음 날)는 `src/core/overtime/alarms.ts` 가 정한다.
 * 아이폰 앱에서 알림 단추(눌렀어요 · 안 남아요 …)로 답하면 앱이 쌓아 두었다가 이 화면이 열릴 때 받아 합친다.
 *
 * 칸 목록은 출근 전 칸이 위, 퇴근 후 칸이 아래이고, 그 사이에 근무시간을 한 바퀴 도는 선(루프)을 가늘게 그린다.
 * 남긴 날에는 칸을 왼쪽으로 밀어 지우고(사전신청만 걸리고 안 남은 칸), 출근 전 · 퇴근 후를 한 번에 지울 수도 있다.
 * 지운 칸은 알림이 울리지 않고, 다음 날 말풍선이 「못 누른 칸(사유)」과 따로 말한다.
 *
 * 색: 이 화면에는 Jev 값도 생성 모델의 글도 없다. 그래서 무지개빛도 회색 규칙도 쓰지 않는다.
 * 파랑은 [확인]을 누르는 칸, 주황은 사유를 쓰는 칸과 정각 10분 전 한 번 더 알림. 그 뜻에만 쓴다.
 */

const CLICK = "#2563eb";
const REASON = "#d97706";
const STORE = "pj-overtime";
/** 지난 날 카드는 이만큼만 들고 있는다. */
const KEEP_DAYS = 14;

const subscribeNothing = () => () => undefined;

type Tab = "today" | "steps" | "faq";

interface TextRange {
  from: string;
  to: string;
}

interface TextGap extends TextRange {
  kind: GapKind;
}

interface Stored {
  base: TextRange;
  days: Record<string, DayNote>;
  alarm: string | null;
  prefs: AlarmPrefs;
}

const PRESETS: TextRange[] = [
  { from: "09:00", to: "18:00" },
  { from: "08:00", to: "17:00" },
  { from: "10:00", to: "19:00" },
  { from: "07:00", to: "16:00" },
  { from: "09:30", to: "18:30" },
];

const KIND_LABEL: Record<GapKind, string> = {
  meal: "식사",
  away: "외출(개인용무)",
  field: "현장·외근",
};

function readStore(): Stored {
  const empty: Stored = { base: PRESETS[0], days: {}, alarm: null, prefs: DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return empty;
    const got = JSON.parse(raw) as Partial<Stored>;
    const base = got.base && parseHhmm(got.base.from) !== null && parseHhmm(got.base.to) !== null ? got.base : empty.base;
    const days: Record<string, DayNote> = {};
    const oldest = kstAt(kstToday(), 0) - KEEP_DAYS * 24 * 60 * 60_000;
    for (const [d, n] of Object.entries(got.days && typeof got.days === "object" ? got.days : {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && kstAt(d, 0) >= oldest) days[d] = n;
    }
    return { base, days, alarm: typeof got.alarm === "string" ? got.alarm : null, prefs: readPrefs(got.prefs) };
  } catch {
    // 저장소를 못 쓰는 창(사생활 보호 등)이어도 화면은 돈다.
    return empty;
  }
}

function writeStore(s: Stored) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // 남기지 못해도 이번 셈에는 문제가 없다.
  }
}

function toRange(r: TextRange): Range | null {
  const from = parseHhmm(r.from);
  const to = parseHhmm(r.to);
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}

/** 셈에서 나온 칸으로 하루 기록을 만든다. 알림 단추로 받은 답(`prev`)은 그대로 둔다. */
function noteOf(plan: Plan, holiday: boolean, form: DayForm, prev?: DayNote): DayNote {
  return {
    ...prev,
    form,
    clicks: plan.slots.flatMap((s) => {
      const at = nudgeAt(s);
      return at === null ? [] : [{ hour: s.hour, at, end: Math.max(...s.windows.map((w) => w.to)) }];
    }),
    reasons: plan.slots.flatMap((s) => (s.reason ? [{ hour: s.hour, reason: s.reason }] : [])),
    exclusions: plan.exclusions,
    done: prev?.done ?? false,
    holiday,
  };
}

/** 주소의 `date` · `slot`. 「못 눌렀어요」 알림이 그 날, 그 칸으로 연다. */
function fromAddress(): { date: string | null; slot: number | null } {
  if (typeof window === "undefined") return { date: null, slot: null };
  const q = new URLSearchParams(window.location.search);
  const date = q.get("date");
  const slot = Number(q.get("slot"));
  return {
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    slot: q.get("slot") !== null && Number.isInteger(slot) && slot >= 0 && slot < 24 ? slot : null,
  };
}

export default function OvertimeApp() {
  // 저장된 값은 브라우저에만 있다. 서버가 그린 빈 화면과 어긋나지 않게 올라온 뒤에 연다.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return (
    <div className="overtime mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6">
      {mounted ? <Board /> : <p className="text-[12px] text-[var(--muted)]">여는 중…</p>}
    </div>
  );
}

function Board() {
  const [first] = useState(readStore);
  const [address] = useState(fromAddress);
  const [tab, setTab] = useState<Tab>("today");
  const [date, setDate] = useState(() => address.date ?? kstToday());
  // 남긴 날이면 그날 넣었던 값으로 연다. 아니면 기본값.
  const [opened] = useState(() => first.days[date]);
  // 휴일근무는 고른 날이 토 · 일이거나 휴일 표(`holidays.ts`)에 있으면 저절로 켜진다. 표에 없는 날은 채팅으로 바꾼다.
  const [holiday, setHoliday] = useState(() => opened?.holiday ?? isHoliday(date));
  const [base, setBase] = useState<TextRange>(() => opened?.form?.base ?? first.base);
  const [spans, setSpans] = useState<TextRange[]>(() => opened?.form?.spans ?? [{ from: first.base.to, to: "21:00" }]);
  const [gaps, setGaps] = useState<TextGap[]>(() => opened?.form?.gaps ?? []);
  const [days, setDays] = useState<Record<string, DayNote>>(first.days);
  const [alarm, setAlarm] = useState<string | null>(first.alarm);
  const [prefs, setPrefs] = useState<AlarmPrefs>(first.prefs);
  const [ready] = useState<PushReady>(pushReady);
  const [native] = useState(isNativeAlarm);
  const [alarmNote, setAlarmNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 날짜를 고르기 전에는 아래 칸을 열지 않는다. 알림으로 연 날, 오늘 남긴 날은 바로 연다.
  const [picked, setPicked] = useState(() => address.date !== null || (first.days[kstToday()] !== undefined && !first.days[kstToday()].done));
  const [moreBase, setMoreBase] = useState(false);
  const [moreGaps, setMoreGaps] = useState(() => gaps.length > 0);
  const [shot, setShot] = useState(0);
  // 말풍선과 시곗바늘이 지금 시각을 따라가게. 30초마다.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const input = useMemo(() => {
    const b = toRange(base) ?? { from: 9 * 60, to: 18 * 60 };
    return {
      holiday,
      base: b,
      spans: spans.map(toRange).filter((r): r is Range => r !== null),
      gaps: gaps
        .map((g) => {
          const r = toRange(g);
          return r ? ({ ...r, kind: g.kind } as Gap) : null;
        })
        .filter((g): g is Gap => g !== null),
    };
  }, [base, holiday, spans, gaps]);

  const plan = useMemo(() => planDay(input), [input]);
  const broken = spans.some((s) => toRange(s) === null) || gaps.some((g) => toRange(g) === null);
  const today = kstToday(now);
  const tomorrow = nextDate(today);
  const nowMinute = Math.floor((now - kstAt(today, 0)) / 60_000);

  // 「이 날 초과로 남기기」를 누른 날만 들고 있는다. 지금 보는 날이 남긴 날이면 넣은 값을 따라 고쳐 보인다.
  // 칸이 없어지면 뺀다. 이미 올렸다고 한 날은 건드리지 않는다.
  const shown = useMemo(() => {
    const next = { ...days };
    const kept = next[date];
    if (kept && !kept.done) {
      if (plan.slots.length > 0) next[date] = noteOf(plan, holiday, { base, spans, gaps }, kept);
      else delete next[date];
    }
    return next;
  }, [days, date, plan, holiday, base, spans, gaps]);

  const saved = shown[date] !== undefined && !shown[date].done;
  const keepDay = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || plan.slots.length === 0) return;
    setDays({ ...shown, [date]: noteOf(plan, holiday, { base, spans, gaps }, shown[date]) });
  };
  const dropDay = () => {
    const next = { ...shown };
    delete next[date];
    setDays(next);
  };

  useEffect(() => writeStore({ base, days: shown, alarm, prefs }), [base, shown, alarm, prefs]);

  // 앱의 알림 단추로 받은 답을 합친다. 화면을 열 때와 다시 앞으로 올 때. 다 받기 전에는 목록을 맞추지 않는다
  // (앱에서 「안 남아요」 한 토막을 옛 목록으로 되살리지 않게).
  const [taken, setTaken] = useState(!native);
  useEffect(() => {
    if (!native) return;
    const take = () =>
      void takeEvents().then((events) => {
        if (events.length > 0) setDays((d) => applyEvents(d, events));
        setTaken(true);
      });
    take();
    const onShow = () => {
      if (document.visibilityState === "visible") take();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [native]);

  // 알림이 켜져 있으면 날마다 할 일이 바뀔 때 맡긴 목록도 맞춘다. 연달아 바뀌면 마지막 것만.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!alarm || !taken) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      void syncJobs(alarm, jobsOf(shown, Date.now(), prefs), prefs.sound).then((ok) => {
        if (!ok) setAlarmNote("알림을 맞추지 못했습니다. 잠시 뒤 다시 열어 주세요.");
      });
    }, 1200);
  }, [alarm, shown, taken, prefs]);

  const turnOn = useCallback(async () => {
    setBusy(true);
    setAlarmNote(null);
    try {
      const got = await subscribe();
      if (!got.ok) {
        setAlarmNote(got.why);
        return;
      }
      setAlarm(alarm ?? newDeviceId());
    } catch {
      setAlarmNote("알림을 켜지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [alarm]);

  const turnOff = useCallback(async () => {
    if (!alarm) return;
    setBusy(true);
    await unsubscribe(alarm);
    setAlarm(null);
    setBusy(false);
  }, [alarm]);

  const markDone = (d: string) => setDays({ ...shown, [d]: { ...shown[d], done: true } });
  /** 칸 하나를 「눌렀어요」로 표시하거나 푼다. 본인 메모이고, 그 칸 알림만 멈춘다. */
  const togglePressed = (hour: number, d: string = date) => {
    const note = shown[d];
    if (!note) return;
    const on = note.pressed?.includes(hour);
    const pressed = on ? (note.pressed ?? []).filter((h) => h !== hour) : [...(note.pressed ?? []), hour].sort((a, b) => a - b);
    setDays({ ...shown, [d]: { ...note, pressed, missed: (note.missed ?? []).filter((h) => h !== hour) } });
  };
  /** 오늘 초과를 지금 끝낸다. 남은 칸 알림이 멈춘다(앱의 「오늘은 끝났어요」와 같다). */
  const endToday = () => {
    const note = shown[today];
    if (!note || note.done || (note.endedAt !== undefined && note.endedAt <= nowMinute)) return;
    setDays({ ...shown, [today]: { ...note, endedAt: nowMinute } });
  };
  /** 「오늘 초과 끝」 단추. 끝내고 무대(PJ)로 올라가 퇴근 지문을 챙긴다. */
  const finishToday = () => {
    endToday();
    setTalk({ user: "", said: { text: END_TEXT, sub: END_SUB } });
    setShot((n) => n + 1);
    document.getElementById("ot-stage")?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
  };
  /** 칸을 지우거나 되살린다. 사전신청만 걸리고 남지 않은 칸. `on` 이 없으면 뒤집는다. */
  const setCut = (hours: number[], on?: boolean, d: string = date) => {
    const note = shown[d];
    if (!note || hours.length === 0) return;
    const now = new Set(note.cut ?? []);
    const add = on ?? !hours.every((h) => now.has(h));
    for (const h of hours) {
      if (add) now.add(h);
      else now.delete(h);
    }
    setDays({ ...shown, [d]: { ...note, cut: [...now].sort((a, b) => a - b) } });
  };
  /** 출근 전(휴일은 오전)인가. 평일은 근무 시작 전 칸, 휴일은 낮 12시 전 칸. */
  const baseFrom = parseHhmm(base.from) ?? 9 * 60;
  const isAm = (hour: number) => (holiday ? hour < 12 : hour * 60 < baseFrom);
  const halfHours = (half: "am" | "pm") => plan.slots.filter((s) => isAm(s.hour) === (half === "am")).map((s) => s.hour);
  /** 「안 남아요」·「끝났어요」를 되돌린다. */
  const undoLeave = () => {
    const note = shown[date];
    if (!note) return;
    setDays({ ...shown, [date]: { ...note, left: [], endedAt: undefined } });
  };

  // 다른 날로 옮기기 전에 지금 날의 고친 값을 굳힌다.
  const pickDate = (value: string) => {
    setDays(shown);
    setDate(value);
    const kept = shown[value];
    if (kept?.form) {
      setHoliday(kept.holiday ?? isHoliday(value));
      setBase(kept.form.base);
      setSpans(kept.form.spans);
      setGaps(kept.form.gaps);
      setMoreGaps(kept.form.gaps.length > 0);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setHoliday(isHoliday(value));
  };
  /** 무대의 날짜 칩. 고르면 아래 칸이 열리고 사진기가 한 번 통통 뛴다. 하던 대화는 닫는다. */
  const choose = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setCalendar(false);
    pickDate(value);
    setPicked(true);
    setTalk(null);
    setShot((n) => n + 1);
  };

  const [calendar, setCalendar] = useState(false);

  // 채팅. 사람이 친 말을 `chat.ts` 가 읽어 답과 제안을 만든다. 「네」를 눌러야 넣는다.
  const [talk, setTalk] = useState<Talk | null>(null);
  const send = (text: string) => {
    // 맥락은 바로 앞 제안 하나만 넘긴다(「오후로」 · 「내일로」 · 「응」).
    // 되묻던 중이면(아침 · 저녁) 저녁 쪽을 앞 제안으로 본다. 「오전으로」 · 「아침」이라고 치면 뒤집힌다.
    const last = talk?.said.proposal ?? talk?.said.choices?.[talk.said.choices.length - 1]?.reply.proposal;
    const said = replyTo(text, { today, date: picked ? date : null, holiday, base, spans, gaps, nowMinute, saved }, last);
    if (said.accept && last) {
      approve(last, text);
      return;
    }
    if (said.reject && last) {
      decline(text);
      return;
    }
    setTalk({ user: text, said });
    setShot((n) => n + 1);
  };
  const approve = (p: Proposal, typed?: string) => {
    const user = typed ?? talk?.user ?? "";
    const day = p.date ?? date;
    if (p.date || !picked) choose(day);
    if (p.holiday !== undefined) setHoliday(p.holiday);
    if (p.base) setBase(p.base);
    if (p.spans) setSpans(p.spans);
    if (p.gaps) {
      setGaps(p.gaps);
      setMoreGaps(p.gaps.length > 0);
    }
    if (p.keep) keepDay();
    if (p.drop) dropDay();
    if (p.end) endToday();
    if (p.cut) setCut(halfHours(p.cut), true);
    if (p.alarm) void turnOn();
    setShot((n) => n + 1);
    const said: Said = p.drop
      ? { text: `${dayLabel(day)} 초과를 뺐어요. 그날 알림도 멈췄어요.` }
      : p.end
      ? { text: END_TEXT, sub: END_SUB }
      : p.cut
      ? { text: "지웠어요. 그 칸들은 안 남은 칸으로 둘게요.", sub: "다음 날 사유 쓸 칸에서 빠져요. 되돌리려면 칸 목록 아래에서 눌러 주세요." }
      : p.keep
      ? { text: `${dayLabel(day)} 초과를 남겼어요. 칸마다 제가 챙길게요.` }
      : p.alarm
        ? { text: "알림 권한을 여쭤볼게요. 「허용」을 눌러 주세요." }
        : saved && !p.date
            ? { text: "바꿨어요. 남긴 날에 바로 반영했고, 알림도 새 시간으로 맞출게요.", sub: "더 고칠 게 있으면 그대로 말씀해 주세요." }
            : { text: "넣었어요. 아래 칸을 보시고 맞으면 「남기기」를 눌러 주세요.", sub: "더 고칠 게 있으면 그대로 말씀해 주세요." };
    setTalk({ user, said });
  };
  const decline = (typed?: string) => setTalk({ user: typed ?? talk?.user ?? "", said: { text: "알겠어요. 다시 말씀해 주세요.", chips: EXAMPLES } });

  // 순서 탭. PJ 가 한 걸음씩 말하고, 물으면 묻고 답하기 자료로 답한다.
  const [stepAt, setStepAt] = useState(0);
  const [stepTalk, setStepTalk] = useState<Talk | null>(null);
  const BACK = "순서로 돌아가기";
  const sendStep = (text: string) => {
    if (text === BACK) {
      setStepTalk(null);
      return;
    }
    const got = stepReply(text, stepAt);
    setStepAt(got.at);
    setStepTalk(got.reply ? { user: text, said: { ...got.reply, chips: [...(got.reply.chips ?? []), BACK] } } : null);
    setShot((n) => n + 1);
  };

  // 묻고 답하기 탭.
  const [faqTalk, setFaqTalk] = useState<Talk | null>(null);
  const sendFaq = (text: string) => {
    setFaqTalk({ user: text, said: answer(text) });
    setShot((n) => n + 1);
  };

  const clicks = plan.slots.filter((s) => s.action === "click").length;
  const note = saved ? shown[date] : undefined;
  // 「안 남아요」 한 토막과 「끝났어요」 뒤 칸. 알림이 울리지 않는 칸이라 흐리게 보인다. 지운 칸은 따로(줄 긋기).
  const cutHours = new Set(note?.cut ?? []);
  const offHours = new Set([...(note ? offHoursOf(note) : [])].filter((h) => !cutHours.has(h)));
  const amSlots = plan.slots.filter((s) => isAm(s.hour));
  const pmSlots = plan.slots.filter((s) => !isAm(s.hour));

  /** 칸 한 줄. 출근 전 칸과 퇴근 후 칸을 따로 그리려고 함수로 둔다. */
  const slotRow = (s: Plan["slots"][number]) => {
    const at = nudgeAt(s);
    const quiet = holiday && s.hour >= 9 && s.hour < 18;
    const pressed = note?.pressed?.includes(s.hour) ?? false;
    const off = offHours.has(s.hour);
    const cut = cutHours.has(s.hour);
    const asked = address.date === date && address.slot === s.hour;
    return (
      <SlotRow key={s.hour} swipe={saved} cut={cut} onCut={() => setCut([s.hour])} style={asked ? { background: "var(--wash)" } : off ? { opacity: 0.5 } : undefined}>
        <div className="w-[64px] shrink-0 text-[13px] font-medium tnum">{slotLabel(s.hour)}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {cut ? (
            <span className="text-[13px] text-[var(--muted)]">
              안 남은 칸{" "}
              <button type="button" onClick={() => setCut([s.hour], false)} className="text-[11px] underline underline-offset-2">
                되돌리기
              </button>
            </span>
          ) : s.action === "click" ? (
            <span className="text-[13px]" style={{ color: CLICK }}>
              <b>[확인]</b> 누르기
              <span className="text-[11px] text-[var(--muted)]">
                {" "}
                · {s.windows.map((w) => `${hhmm(w.from)}~${hhmm(w.to)}`).join(", ")} 사이
                {at !== null && ` (권장 ${hhmm(at)}쯤)`}
              </span>
            </span>
          ) : (
            <span className="text-[13px]" style={{ color: REASON }}>
              미기록 사유 <b>「{s.reason}」</b>
            </span>
          )}
          {!cut && quiet && s.action === "click" && <span className="text-[11px] text-[var(--muted)]">휴일 낮이라 알림이 안 뜹니다. 직접 누릅니다.</span>}
          {!cut && s.notes.map((n) => (
            <span key={n} className="text-[11px] text-[var(--muted)]">
              {n}
            </span>
          ))}
          {asked && !cut && s.action === "click" && !pressed && (
            <span className="text-[11px]" style={{ color: REASON }}>
              못 눌렀다면 이 칸은 미기록 사유를 씁니다. 그 시간에 무엇을 했는지 그대로 적습니다(식사 · 현장근무 · 개인용무 외출 등).
            </span>
          )}
        </div>
        {saved && !cut && s.action === "click" && (
          <button
            onClick={() => togglePressed(s.hour)}
            className="h-fit shrink-0 rounded-md border px-2 py-1 text-[11px]"
            style={pressed ? { borderColor: CLICK, background: CLICK, color: "#fff" } : { borderColor: CLICK, color: CLICK }}
            aria-pressed={pressed}
          >
            {pressed ? "눌렀어요 ✓" : "눌렀어요"}
          </button>
        )}
      </SlotRow>
    );
  };

  const line = lineOf({
    now,
    days: shown,
    date: picked ? date : null,
    draft: picked && !saved ? { clicks, reasons: plan.slots.length - clicks } : null,
    alarm: alarm !== null,
    native,
    prefs,
  });
  const other = picked && date !== today && date !== tomorrow;
  const ended = note?.endedAt !== undefined && note.endedAt <= nowMinute;

  return (
    <>
      <header>
        <h1 className="text-[15px] font-semibold tracking-tight">초과기록</h1>
        <p className="text-[11px] text-[var(--muted)]">날짜와 초과 시간을 넣으면 인사랑에서 누를 칸과 쓸 사유가 나옵니다. 넣은 값은 이 기기에만 남습니다.</p>
        {/* 사진일지와 같은 점 줄. 이 화면에는 모델이 없어 PJ 하나뿐이다. */}
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--muted)]">
          <span className="inline-flex items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={11} height={11} className="h-[11px] w-[11px] rounded-[2px]" />
            PJ
          </span>
          <span>· 모델 미사용</span>
        </div>
        <nav className="mt-3 flex w-fit gap-1 rounded-full p-1" style={{ background: "var(--wash)" }}>
          {(
            [
              ["today", "초과기록"],
              ["steps", "순서"],
              ["faq", "묻고 답하기"],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className="rounded-full px-3.5 py-1.5 text-[12.5px]"
              style={tab === key ? { background: "var(--paper)", color: "var(--ink)", fontWeight: 600 } : { color: "var(--muted)" }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "today" ? (
        <>
          <Stage
            id="ot-stage"
            said={talk?.said ?? line}
            user={talk?.user ?? null}
            onCloseTalk={() => setTalk(null)}
            onSend={send}
            placeholder="예: 오늘 6시부터 9시까지"
            examples={talk || saved ? [] : EXAMPLES}
            minute={nowMinute}
            shot={shot}
            busy={busy}
            tall={!picked}
            acts={{
              onUploaded: markDone,
              onPress: (hour) => togglePressed(hour, today),
              onEnd: finishToday,
              onYes: approve,
              onNo: () => decline(),
              onChip: send,
              onChoice: (label, reply) => {
                setTalk({ user: label, said: reply });
                setShot((n) => n + 1);
              },
              alarm: { ready, busy, note: alarmNote, onOn: () => void turnOn() },
            }}
          >
            <div className="flex flex-col items-center gap-2.5">
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => choose(today)} aria-pressed={picked && date === today} className="ot-chip rounded-full px-5 py-2 text-[14px] font-medium">
                  오늘
                </button>
                <button type="button" onClick={() => choose(tomorrow)} aria-pressed={picked && date === tomorrow} className="ot-chip rounded-full px-5 py-2 text-[14px] font-medium">
                  내일
                </button>
                {/* 폰 기본 달력 대신 무대와 같은 꼴의 달력을 칩 아래에 편다. */}
                <button
                  type="button"
                  onClick={() => setCalendar(!calendar)}
                  aria-expanded={calendar}
                  data-on={other || calendar ? "1" : undefined}
                  className={`ot-chip rounded-full px-5 py-2 text-[14px] font-medium ${other ? "tnum" : ""}`}
                >
                  {other ? dayLabel(date) : "다른 날"}
                </button>
              </div>
              {calendar && (
                <MonthPick
                  value={picked ? date : null}
                  today={today}
                  marked={Object.keys(shown).filter((d) => !shown[d].done)}
                  onPick={(d) => {
                    setCalendar(false);
                    choose(d);
                  }}
                />
              )}
            </div>
          </Stage>

          {picked && (
            <div key={date} className="ot-open flex flex-col gap-4">
              <section className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] p-4">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold">
                  {holiday ? "휴일근무 시간" : "초과 시간"}
                  {holiday && (
                    <span className="ot-holiday rounded-full px-2 py-0.5 text-[11px]" data-on="1">
                      휴일
                    </span>
                  )}
                  {holiday && holidayLabel(date) && <span className="text-[11px] font-normal text-[var(--muted)]">{holidayLabel(date)}</span>}
                </h2>
                <div className="flex w-full flex-col gap-2">
                  {spans.map((s, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <TimePair value={s} onChange={(v) => setSpans(spans.map((x, j) => (j === i ? v : x)))} />
                      {spans.length > 1 && <Remove onClick={() => setSpans(spans.filter((_, j) => j !== i))} />}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-1">
                    {/* 더한 토막은 시각 순으로 선다. 출근 전은 위, 퇴근 후는 아래. */}
                    {!holiday && <Add onClick={() => setSpans(byTime([...spans, { from: shift(base.from, -60), to: base.from }]))}>출근 전</Add>}
                    <Add onClick={() => setSpans(byTime([...spans, { from: holiday ? "09:00" : base.to, to: holiday ? "18:00" : shift(base.to, 120) }]))}>
                      {holiday ? "토막 더" : "퇴근 후 토막 더"}
                    </Add>
                    {!moreGaps && <Add onClick={() => setMoreGaps(true)}>자리 비운 때(식사 · 외출 · 현장)</Add>}
                  </div>
                </div>

                {moreGaps && (
                  <div className="flex w-full flex-col gap-2 border-t border-[var(--line)] pt-3">
                    <span className="text-[12px] text-[var(--muted)]">자리 비운 때</span>
                    {gaps.length === 0 && <p className="text-[11px] text-[var(--muted)]">없으면 비워 둡니다. 식사도 여기 넣습니다.</p>}
                    {gaps.map((g, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select
                          value={g.kind}
                          onChange={(e) => setGaps(gaps.map((x, j) => (j === i ? { ...x, kind: e.target.value as GapKind } : x)))}
                          className={FIELD}
                        >
                          {(Object.keys(KIND_LABEL) as GapKind[]).map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                        <TimePair value={g} onChange={(v) => setGaps(gaps.map((x, j) => (j === i ? { ...x, ...v } : x)))} />
                        <Remove onClick={() => setGaps(gaps.filter((_, j) => j !== i))} />
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-1">
                      {(Object.keys(KIND_LABEL) as GapKind[]).map((k) => {
                        const start = spans[0]?.from ?? base.to;
                        return (
                          <Add key={k} onClick={() => setGaps([...gaps, { kind: k, from: start, to: shift(start, 60) }])}>
                            {KIND_LABEL[k]}
                          </Add>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 근무시간은 한 번 맞추면 이 기기에 남는다. 평소에는 접어 둔다. */}
                {!holiday && (
                  <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3 text-[12px]">
                    <button type="button" onClick={() => setMoreBase(!moreBase)} className="w-fit text-[var(--muted)]">
                      내 근무 <span className="tnum">{base.from}~{base.to}</span> · <span className="underline underline-offset-2">{moreBase ? "접기" : "바꾸기"}</span>
                    </button>
                    {moreBase && (
                      <div className="flex flex-wrap items-center gap-2">
                        <TimePair value={base} onChange={setBase} />
                        <div className="flex flex-wrap gap-1">
                          {PRESETS.map((p) => {
                            const on = p.from === base.from && p.to === base.to;
                            return (
                              <button
                                key={`${p.from}-${p.to}`}
                                onClick={() => setBase(p)}
                                className="rounded-md border px-2 py-1 text-[11px] tnum"
                                style={{ borderColor: on ? "var(--ink)" : "var(--line)", color: on ? "var(--ink)" : "var(--muted)" }}
                              >
                                {p.from}~{p.to}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-3">
                {broken && <p className="text-[12px]" style={{ color: REASON }}>끝이 시작보다 앞선 시간은 셈에서 뺐습니다.</p>}

                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
                  <span>
                    <b className="tnum">{plan.slots.length}</b>칸 중 <b style={{ color: CLICK }}>[확인] {clicks}</b> ·{" "}
                    <b style={{ color: REASON }}>사유 {plan.slots.length - clicks}</b>
                  </span>
                  <span className="text-[12px] text-[var(--muted)]">
                    초과 {spell(plan.overtimeMinutes)}
                    {plan.awayMinutes > 0 && ` · 외출 ${spell(plan.awayMinutes)}`}
                    {plan.mealMinutes > 0 && ` · 식사 ${spell(plan.mealMinutes)}`}
                  </span>
                </div>

                {plan.slots.length > 0 && (
                  <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
                    {amSlots.map(slotRow)}
                    {/* 출근 전과 퇴근 후 사이. 근무시간을 한 바퀴 도는 선. 오늘 근무 중이면 점이 그 길을 돈다. */}
                    {!holiday && amSlots.length > 0 && pmSlots.length > 0 && (
                      <WorkLoop label={`근무 ${base.from}~${base.to}`} moving={date === today && nowMinute >= baseFrom && nowMinute < (parseHhmm(base.to) ?? 18 * 60)} />
                    )}
                    {pmSlots.map(slotRow)}
                  </div>
                )}

                {saved && plan.slots.length > 0 && (
                  <div className="-mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-[var(--muted)]">
                    <span>안 남은 칸 지우기</span>
                    {(["am", "pm"] as const).map((half) => {
                      const hours = halfHours(half);
                      if (hours.length === 0) return null;
                      const all = hours.every((h) => cutHours.has(h));
                      const name = holiday ? (half === "am" ? "오전" : "오후") : half === "am" ? "출근 전" : "퇴근 후";
                      return (
                        <button key={half} type="button" onClick={() => setCut(hours)} className="rounded-full border border-[var(--line)] px-2.5 py-0.5">
                          {all ? `${name} 되돌리기` : `${name} 모두`}
                        </button>
                      );
                    })}
                    <span>· 한 칸만은 왼쪽으로 밀어요.</span>
                  </div>
                )}

                {(plan.exclusions.length > 0 || plan.mealMinutes > 0) && (
                  <div className="rounded-2xl border border-[var(--line)] px-3 py-2.5 text-[12px] leading-relaxed">
                    <b>근무제외시간</b>:{" "}
                    {plan.exclusions.length > 0
                      ? plan.exclusions.map((r) => `${hhmm(r.from)}~${hhmm(r.to)}`).join(", ") + " (외출만 넣습니다)"
                      : "넣을 것 없음"}
                    {plan.mealMinutes > 0 && (
                      <span className="text-[var(--muted)]">
                        {holiday ? " · 식사는 넣지 않습니다." : " · 식사는 넣지 않습니다(평일 1시간 자동 공제)."}
                      </span>
                    )}
                  </div>
                )}

                {plan.warnings.map((w) => (
                  <p key={w} className="text-[12px]" style={{ color: REASON }}>
                    {w}
                  </p>
                ))}

                {saved ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border px-4 py-2 text-[13px] font-medium" style={{ borderColor: "var(--ink)" }}>
                      {dayLabel(date)} 남김 ✓
                    </span>
                    {date === today && !ended && (
                      <button type="button" onClick={finishToday} className="ot-hint rounded-full px-3.5 py-1.5 text-[12.5px] font-medium">
                        오늘 초과 끝
                      </button>
                    )}
                    <button onClick={dropDay} className="text-[11px] text-[var(--muted)] underline underline-offset-2">
                      빼기
                    </button>
                    {offHours.size > 0 && (
                      <span className="flex w-full flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                        {note?.endedAt !== undefined ? `${hhmm(note.endedAt)}에 끝났다고 했습니다.` : "안 남는다고 한 토막이 있습니다."} 흐린 칸은 알림이 울리지 않습니다.
                        <button onClick={undoLeave} className="underline underline-offset-2">
                          되돌리기
                        </button>
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      keepDay();
                      setTalk(null);
                      setShot((n) => n + 1);
                    }}
                    disabled={plan.slots.length === 0}
                    className="w-full rounded-full px-4 py-3 text-[14px] font-semibold disabled:opacity-40"
                    style={{ background: "var(--ink)", color: "var(--paper)" }}
                  >
                    {dayLabel(date)} 남기기
                  </button>
                )}

                {(saved || alarm !== null) && (
                  <Alarm prefs={prefs} onPrefs={setPrefs} ready={ready} native={native} on={alarm !== null} busy={busy} note={alarmNote} onOn={turnOn} onOff={turnOff} />
                )}
              </section>
            </div>
          )}
        </>
      ) : tab === "steps" ? (
        <>
          <Stage
            said={stepTalk?.said ?? { ...stepLine(stepAt), nav: { at: stepAt, total: STEPS.length } }}
            user={stepTalk?.user ?? null}
            onCloseTalk={() => setStepTalk(null)}
            onSend={sendStep}
            placeholder="예: 다음 · 3번 · 식사 시간도 사유 쓰나요?"
            examples={stepTalk ? [] : ["처음부터", "식사 시간도 사유 쓰나요?"]}
            minute={nowMinute}
            shot={shot}
            busy={false}
            tall
            acts={{
              onChip: sendStep,
              onPrev: () => {
                setStepAt(Math.max(0, stepAt - 1));
                setShot((n) => n + 1);
              },
              onNext: () => {
                setStepAt(Math.min(STEPS.length - 1, stepAt + 1));
                setShot((n) => n + 1);
              },
            }}
          >
            {/* 걸음 점. 누르면 그 걸음으로. */}
            <div className="flex gap-1.5" role="tablist" aria-label="순서">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === stepAt}
                  aria-label={`${i + 1}번째`}
                  onClick={() => {
                    setStepAt(i);
                    setStepTalk(null);
                  }}
                  className="ot-step h-2.5 rounded-full"
                  style={{ width: i === stepAt ? 22 : 10 }}
                />
              ))}
            </div>
          </Stage>
          <Checklist />
        </>
      ) : (
        <>
          <Stage
            said={faqTalk?.said ?? { text: "궁금한 걸 물어보세요. 제가 가진 자료(법령 · 지침 · 사용 안내)에 있는 것만 답할게요.", chips: QUESTION_EXAMPLES }}
            user={faqTalk?.user ?? null}
            onCloseTalk={() => setFaqTalk(null)}
            onSend={sendFaq}
            placeholder="예: 주말 낮에도 알림이 뜨나요?"
            examples={[]}
            minute={nowMinute}
            shot={shot}
            busy={false}
            tall
            acts={{ onChip: sendFaq }}
          />
          <details className="rounded-2xl border border-[var(--line)] px-4 py-3">
            <summary className="cursor-pointer text-[13px] font-medium">질문 전체 보기({FAQ.length})</summary>
            <div className="mt-3">
              <FaqList />
            </div>
          </details>
        </>
      )}

      <footer className="mt-auto flex flex-col gap-1.5 border-t border-[var(--line)] pt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        {tab !== "today" && <Sources />}
        <p>
          <Link href="/" className="underline underline-offset-2">
            순찰일지
          </Link>
          {" · "}
          <a href="https://github.com/patrol-jev/patrol-jev" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            GitHub
          </a>
        </p>
        <p>이 화면은 칸을 대신 누르지 않습니다. 직접 누르도록 알려 줄 뿐입니다.</p>
      </footer>
    </>
  );
}

/** 한 글자를 치는 사이(ms). 문장이 끝나면 조금 쉬고 다음 줄로 간다. 처음에는 점 셋이 잠깐 뛴다. */
const TYPE_MS = 34;
const SENTENCE_PAUSE = 420;
const FIRST_PAUSE = 450;

/** 움직임 줄이기를 켠 기기는 치지 않고 한 번에 보인다. */
const calm = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** 말풍선에 올 것. 상태 말(`talk.ts`)이거나 채팅 답(`chat.ts`)이다. */
type Said = Line & {
  /** 「네, ○○ 주세요」 · 「아니요」. 「네」의 글은 `said.yes`. */
  proposal?: Proposal;
  /** 「네」 단추의 글(묻는 말과 짝). 없으면 「네, 넣어 주세요」. */
  yes?: string;
  /** 아침 · 저녁 되묻기. 누르면 그 답으로 이어진다. */
  choices?: Array<{ label: string; reply: Said }>;
  /** 이어서 눌러 볼 말. 누르면 그 말을 보낸다. */
  chips?: string[];
  /** 순서 탭의 「이전」 · 「다음」. */
  nav?: { at: number; total: number };
};

/** 주고받은 한 번. 사람이 친 말과 PJ 의 답. */
interface Talk {
  user: string;
  said: Said;
}

interface Acts {
  onUploaded?: (date: string) => void;
  onPress?: (hour: number) => void;
  onEnd?: () => void;
  onYes?: (proposal: Proposal) => void;
  onNo?: () => void;
  onChip?: (text: string) => void;
  onChoice?: (label: string, reply: Said) => void;
  onPrev?: () => void;
  onNext?: () => void;
  alarm?: { ready: PushReady; busy: boolean; note: string | null; onOn: () => void };
}

/**
 * 무대. 세 탭(초과기록 · 순서 · 묻고 답하기)이 같이 쓴다.
 * 위 = PJ 의 말풍선, 가운데 = 시계 사진기, 그 아래 = 탭마다 다른 것(날짜 칩 등), 맨 아래 = 내가 한 말과 채팅 막대.
 */
function Stage({
  id,
  said,
  user,
  onCloseTalk,
  onSend,
  placeholder,
  examples,
  minute,
  shot,
  busy,
  tall,
  acts,
  children,
}: {
  /** 「오늘 초과 끝」 뒤 이 자리로 올라온다. 초과기록 탭의 무대에만. */
  id?: string;
  said: Said;
  user: string | null;
  onCloseTalk: () => void;
  onSend: (text: string) => void;
  placeholder: string;
  examples: string[];
  minute: number;
  shot: number;
  busy: boolean;
  tall: boolean;
  acts: Acts;
  children?: React.ReactNode;
}) {
  return (
    <section
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--look-x", (((event.clientX - rect.left) / rect.width - 0.5) * 2).toFixed(3));
        event.currentTarget.style.setProperty("--look-y", (((event.clientY - rect.top) / rect.height - 0.5) * 2).toFixed(3));
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--look-x", "0");
        event.currentTarget.style.setProperty("--look-y", "0");
      }}
      id={id}
      className="ot-stage flex scroll-mt-3 flex-col items-center justify-center gap-2 rounded-[28px] px-4 pb-5 pt-6"
      style={{ minHeight: tall ? 460 : undefined }}
    >
      <div className="ot-bubble w-full max-w-[460px] rounded-[20px] px-4 py-3.5" aria-live="polite" data-late={said.late ? "1" : undefined}>
        <Typed key={`${user ?? ""}|${said.text}`} said={said} acts={acts} />
      </div>
      <span className="my-6 scale-[1.7] drop-shadow-[0_8px_12px_rgba(40,52,120,0.18)]">
        <OvertimeClockMark minute={minute} shot={shot} busy={busy} />
      </span>
      {children}
      <div className="mt-3 flex w-full max-w-[460px] flex-col gap-2">
        {user && (
          <div className="ot-open flex items-start justify-end gap-1.5">
            <p className="ot-me max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-[13.5px] leading-relaxed">{user}</p>
            <button type="button" onClick={onCloseTalk} aria-label="대화 닫기" className="mt-1 h-6 w-6 shrink-0 rounded-full text-[13px] text-[var(--muted)]">
              ✕
            </button>
          </div>
        )}
        <ChatBar placeholder={placeholder} onSend={onSend} />
        {examples.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {examples.map((e) => (
              <button key={e} type="button" onClick={() => onSend(e)} className="ot-hint rounded-full px-3 py-1 text-[12px]">
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** 채팅 막대. 폰에서 확대되지 않게 글자는 16px. */
function ChatBar({ placeholder, onSend }: { placeholder: string; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const ready = text.trim().length > 0;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onSend(text.trim());
        setText("");
      }}
      className="ot-chat flex w-full items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label="PJ에게 말하기"
        enterKeyHint="send"
        className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--muted)]"
      />
      <button type="submit" aria-label="보내기" disabled={!ready} className="ot-send flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:opacity-35">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}

/**
 * 말풍선 속. PJ 가 하는 말 한 마디를 한 글자씩 친다. 문장마다 한 줄이고, 새로 친 글자는 흰빛에서 먹색으로 짙어진다.
 * 아직 안 친 글자도 자리는 잡아 두어(보이지 않게) 말풍선 크기가 치는 동안 흔들리지 않는다. 말풍선을 누르면 바로 다 보인다.
 * 다 친 뒤에 작은 줄과 단추가 떠오른다.
 */
function Typed({ said, acts }: { said: Said; acts: Acts }) {
  const sentences = useMemo(() => sentencesOf(said.text), [said.text]);
  const starts = useMemo(() => sentences.map((_, i) => sentences.slice(0, i).reduce((sum, s) => sum + s.length, 0)), [sentences]);
  const total = sentences.reduce((sum, s) => sum + s.length, 0);
  const [shown, setShown] = useState(() => (calm() ? total : 0));
  const done = shown >= total;

  useEffect(() => {
    if (shown >= total) return;
    const pause = starts.includes(shown) && shown > 0;
    const id = setTimeout(() => setShown((n) => n + 1), shown === 0 ? FIRST_PAUSE : pause ? SENTENCE_PAUSE : TYPE_MS);
    return () => clearTimeout(id);
  }, [shown, total, starts]);

  const button = "rounded-full px-4 py-1.5 text-[12.5px] font-semibold";
  return (
    <div className="relative min-h-[40px]" onClick={() => setShown(total)}>
      {shown === 0 && (
        <span className="ot-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <p className="text-[14px] font-medium leading-relaxed" aria-label={said.text}>
        {sentences.map((s, index) => {
          const typed = Math.max(0, Math.min(s.length, shown - starts[index]));
          return (
            <span key={index} className="block" aria-hidden="true">
              {[...s.slice(0, typed)].map((ch, at) => (
                <span key={at} className="ot-ink">
                  {ch}
                </span>
              ))}
              <span style={{ visibility: "hidden" }}>{s.slice(typed)}</span>
            </span>
          );
        })}
      </p>
      {done && (
        <div className="ot-say" onClick={(event) => event.stopPropagation()}>
          {said.sub && <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{said.sub}</p>}
          {said.offer === "alarm" && acts.alarm && <AlarmOffer {...acts.alarm} />}
          {(said.uploaded !== undefined || said.press !== undefined || said.proposal || said.nav || (said.end && acts.onEnd)) && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {said.uploaded !== undefined && acts.onUploaded && (
                <button type="button" onClick={() => acts.onUploaded!(said.uploaded!)} className={button} style={{ background: "var(--ink)", color: "var(--paper)" }}>
                  {said.close ?? "올렸어요"}
                </button>
              )}
              {said.press !== undefined && acts.onPress && (
                <button type="button" onClick={() => acts.onPress!(said.press!)} className={button} style={{ background: CLICK, color: "#fff" }}>
                  눌렀어요
                </button>
              )}
              {said.end && acts.onEnd && (
                <button type="button" onClick={acts.onEnd} className={`${button} ot-hint`}>
                  오늘 초과 끝
                </button>
              )}
              {said.proposal && acts.onYes && (
                <>
                  <button type="button" onClick={() => acts.onYes!(said.proposal!)} className={button} style={{ background: "var(--ink)", color: "var(--paper)" }}>
                    {said.yes ?? "네, 넣어 주세요"}
                  </button>
                  <button type="button" onClick={acts.onNo} className={`${button} ot-hint`}>
                    아니요
                  </button>
                </>
              )}
              {said.nav && (
                <>
                  <button type="button" onClick={acts.onPrev} disabled={said.nav.at === 0} className={`${button} ot-hint disabled:opacity-35`}>
                    이전
                  </button>
                  <button
                    type="button"
                    onClick={acts.onNext}
                    disabled={said.nav.at >= said.nav.total - 1}
                    className={`${button} disabled:opacity-35`}
                    style={{ background: "var(--ink)", color: "var(--paper)" }}
                  >
                    다음
                  </button>
                </>
              )}
            </div>
          )}
          {said.choices && said.choices.length > 0 && acts.onChoice && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {said.choices.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => acts.onChoice!(c.label, c.reply)}
                  className="tnum rounded-full px-4 py-1.5 text-[12.5px] font-semibold"
                  style={{ background: "var(--ink)", color: "var(--paper)" }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {said.chips && said.chips.length > 0 && acts.onChip && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {said.chips.map((c) => (
                <button key={c} type="button" onClick={() => acts.onChip!(c)} className="ot-hint rounded-full px-3 py-1 text-left text-[12px]">
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 「알림을 켜 두면 칸마다 제가 챙길게요.」 라벨. 캐릭터와 같은 연보라이고, 누르면 알림이 켜진다(권한 창). */
function AlarmOffer({ ready, busy, note, onOn }: { ready: PushReady; busy: boolean; note: string | null; onOn: () => void }) {
  if (ready === "install") {
    return <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">{ALARM_OFF} 아이폰은 공유 → 「홈 화면에 추가」 한 뒤 켤 수 있어요.</p>;
  }
  if (ready !== "yes") return null;
  return (
    <>
      <button
        type="button"
        onClick={onOn}
        disabled={busy}
        className="ot-offer mt-2.5 flex w-full items-center gap-2 rounded-2xl px-3.5 py-2.5 text-left text-[13px] font-semibold disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ot-bell shrink-0">
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" fill="#fff" />
          <path d="M10 20.5a2.2 2.2 0 0 0 4 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="min-w-0 flex-1">{ALARM_OFF}</span>
        <span className="shrink-0 rounded-full bg-white/25 px-2.5 py-1 text-[11.5px]">{busy ? "켜는 중…" : "켜기"}</span>
      </button>
      {note && (
        <p className="mt-1 text-[11px]" style={{ color: REASON }}>
          {note}
        </p>
      )}
    </>
  );
}

/**
 * 「다른 날」 달력. 폰 기본 달력 대신 무대와 같은 꼴로 그린다(말풍선과 같은 흰 카드, 둥근 날짜).
 * 고른 날 = 먹색 동그라미 · 오늘 = 연보라 테두리 · 남긴 날 = 연보라 점. 주말은 글자만 옅다.
 */
function MonthPick({ value, today, marked, onPick }: { value: string | null; today: string; marked: string[]; onPick: (date: string) => void }) {
  const [month, setMonth] = useState(() => (value ?? today).slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const move = (by: number) => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const cells: Array<string | null> = [...Array(first).fill(null)];
  for (let d = 1; d <= count; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  const marks = new Set(marked);
  return (
    <div className="ot-bubble ot-open w-full max-w-[340px] rounded-[20px] px-3 pb-3 pt-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} aria-label="앞 달" className="h-9 w-9 rounded-full text-[18px] text-[var(--muted)]">
          ‹
        </button>
        <span className="tnum text-[14px] font-semibold">
          {y}년 {m}월
        </span>
        <button type="button" onClick={() => move(1)} aria-label="다음 달" className="h-9 w-9 rounded-full text-[18px] text-[var(--muted)]">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {"일월화수목금토".split("").map((w) => (
          <span key={w} className="pb-1 text-[11px] text-[var(--muted)]">
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-pressed={d === value}
              aria-label={dayLabel(d)}
              data-today={d === today ? "1" : undefined}
              data-weekend={i % 7 === 0 || i % 7 === 6 ? "1" : undefined}
              className="ot-day tnum relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-[13.5px]"
            >
              {Number(d.slice(8))}
              {marks.has(d) && <span className="ot-day-dot absolute bottom-[3px] h-1 w-1 rounded-full" />}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

const FIELD = "rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-[13px] tnum";

function shift(text: string, minutes: number): string {
  const m = parseHhmm(text);
  if (m === null) return text;
  return hhmm(Math.max(0, Math.min(24 * 60, m + minutes)));
}

/** 토막을 시작 시각 순으로. 못 읽는 칸은 맨 뒤로(넣은 차례대로). */
function byTime(list: TextRange[]): TextRange[] {
  return list
    .map((r, i) => ({ r, i, at: parseHhmm(r.from) ?? 24 * 60 + i }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map((x) => x.r);
}

/** 이만큼 밀면 지운다(px). */
const SWIPE_CUT = 72;

/**
 * 칸 한 줄. 남긴 날에는 손가락으로 왼쪽으로 밀어 지운다(지운 칸을 다시 밀면 되살린다). 밀리는 동안 뒤에 「지우기」가 보인다.
 * 세로로 움직이면 화면을 내리는 것으로 보고 놓아 준다(`touch-action: pan-y`). 단추 위에서 시작한 손짓은 밀지 않는다.
 */
function SlotRow({ swipe, cut, onCut, style, children }: { swipe: boolean; cut: boolean; onCut: () => void; style?: React.CSSProperties; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const [held, setHeld] = useState(false);
  const start = useRef<{ x: number; y: number; id: number; moving: boolean } | null>(null);
  const reset = () => {
    start.current = null;
    setHeld(false);
    setDx(0);
  };
  return (
    <div className="relative border-b border-[var(--line)] last:border-b-0">
      {swipe && dx < 0 && (
        <div className="ot-row-back absolute inset-0 flex items-center justify-end pr-4 text-[12px] font-semibold" data-ready={dx <= -SWIPE_CUT ? "1" : undefined}>
          {cut ? "되살리기" : "지우기"}
        </div>
      )}
      <div
        className={`ot-row relative flex gap-3 px-3 py-2.5 ${swipe ? "select-none" : ""}`}
        data-cut={cut ? "1" : undefined}
        style={{ ...style, transform: dx ? `translateX(${dx}px)` : undefined, transition: held ? "none" : undefined, touchAction: swipe ? "pan-y" : undefined }}
        onPointerDown={(e) => {
          if (!swipe || (e.target as HTMLElement).closest("button")) return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moving: false };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          const x = e.clientX - s.x;
          const y = e.clientY - s.y;
          if (!s.moving) {
            if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) {
              start.current = null;
              return;
            }
            if (Math.abs(x) < 8) return;
            s.moving = true;
            setHeld(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setDx(Math.max(-120, Math.min(0, x)));
        }}
        onPointerUp={() => {
          if (dx <= -SWIPE_CUT) onCut();
          reset();
        }}
        onPointerCancel={reset}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 출근 전 칸과 퇴근 후 칸 사이의 구분. 세로 선이 근무시간 동안 한 바퀴 돌고 다시 내려간다.
 * 티 나지 않게 옅은 선이고, 오늘 근무 중이면 연보라 점이 그 바퀴를 천천히 돈다.
 */
function WorkLoop({ label, moving }: { label: string; moving: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--line)] px-3" aria-label={label}>
      <svg width="64" height="28" viewBox="0 0 64 28" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M32 0 V6 C32 16 46 18 46 11 C46 3 32 3 32 13 V28" className="ot-loop" strokeWidth="1.4" strokeLinecap="round" />
        {moving && !calm() && (
          <circle r="2.4" fill="#5b7cfa">
            <animateMotion dur="4.8s" repeatCount="indefinite" path="M32 6 C32 16 46 18 46 11 C46 3 32 3 32 13" />
          </circle>
        )}
      </svg>
      <span className="tnum text-[11px] text-[var(--muted)]">{label}</span>
    </div>
  );
}

/**
 * 시각 칸. 그 자리에서 바로 친다. 폰의 시계 입력은 「오전·오후」로 보여서 쓰지 않는다.
 * "18", "1830", "930", "18:30" 어느 꼴이든 24시간 꼴 "18:30" 으로 맞춘다(`readTyped`).
 * 네 자리나 "시:분" 을 다 치면 바로 반영하고, 칸을 떠날 때 모양을 맞춘다. 못 읽으면 테두리가 주황이 된다.
 */
function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const bad = draft !== null && draft.trim() !== "" && readTyped(draft) === null;
  return (
    <input
      value={text}
      inputMode="numeric"
      aria-label={label}
      placeholder="18:00"
      onFocus={(e) => {
        setDraft(value);
        e.target.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const done = /^\d{4}$/.test(raw.trim()) || /^\d{1,2}[:.]\d{2}$/.test(raw.trim());
        const got = readTyped(raw);
        if (done && got) onChange(got);
      }}
      onBlur={() => {
        const got = draft === null ? null : readTyped(draft);
        if (got) onChange(got);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`${FIELD} w-[64px] text-center`}
      style={bad ? { borderColor: REASON } : undefined}
    />
  );
}

function TimePair({ value, onChange }: { value: TextRange; onChange: (v: TextRange) => void }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <TimeInput label="시작" value={value.from} onChange={(from) => onChange({ ...value, from })} />
      <span className="text-[var(--muted)]">~</span>
      <TimeInput label="끝" value={value.to} onChange={(to) => onChange({ ...value, to })} />
    </span>
  );
}

function Add({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-md border border-dashed border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)]">
      + {children}
    </button>
  );
}

function Remove({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="빼기" className="px-1 text-[13px] text-[var(--muted)]">
      ✕
    </button>
  );
}

function Alarm({
  prefs,
  onPrefs,
  ready,
  native,
  on,
  busy,
  note,
  onOn,
  onOff,
}: {
  prefs: AlarmPrefs;
  onPrefs: (p: AlarmPrefs) => void;
  ready: PushReady;
  native: boolean;
  on: boolean;
  busy: boolean;
  note: string | null;
  onOn: () => void;
  onOff: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {on ? (
          <>
            <span className="rounded-md border px-3 py-1.5 text-[12px]" style={{ borderColor: CLICK, color: CLICK }}>
              진동 알림 켜짐
            </span>
            <button onClick={onOff} disabled={busy} className="text-[11px] text-[var(--muted)] underline underline-offset-2">
              끄기
            </button>
          </>
        ) : (
          <button
            onClick={onOn}
            disabled={busy || ready !== "yes"}
            className="rounded-md border px-3 py-1.5 text-[12px] disabled:opacity-40"
            style={{ borderColor: CLICK, color: CLICK }}
          >
            진동 알림 켜기
          </button>
        )}
        <span className="text-[11px] text-[var(--muted)]">
          남긴 날의 [확인] 칸마다, 그리고 다음 근무일에 「올렸어요」를 누를 때까지 근무시간 매시 10분에 울립니다.
          {native && " 앱에서는 토막 10분 전에 「남으세요?」를 묻고, 끝나면 하루 요약을 보냅니다. 알림 단추로 「눌렀어요」 · 「10분 뒤」 · 「오늘은 끝났어요」를 고릅니다."}
        </span>
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        {native ? "앱 알림은 이 폰이 직접 울립니다. 서버에도 맡기지 않습니다." : "진동 알림을 켜면 울릴 시각만 서버에 맡깁니다."}
      </p>
      {/* 설정은 접어 둔다. 처음 쓰는 사람은 기본값 그대로 두면 된다. */}
      {on && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-[var(--muted)]">알림 설정(받는 시간 · 묻는 때 · 소리)</summary>
          <div className="mt-2">
            <AlarmPrefsBox prefs={prefs} onPrefs={onPrefs} native={native} />
          </div>
        </details>
      )}
      {ready === "install" && !on && (
        <p className="text-[11px] text-[var(--muted)]">아이폰은 공유 → 「홈 화면에 추가」 한 뒤, 홈 화면의 초과기록에서 켭니다.</p>
      )}
      {ready === "no" && <p className="text-[11px] text-[var(--muted)]">이 브라우저는 알림을 받을 수 없습니다.</p>}
      {note && (
        <p className="text-[11px]" style={{ color: REASON }}>
          {note}
        </p>
      )}
    </div>
  );
}

/** 알림 설정. 받는 시간 · 묻는 때 · 소리. 고치면 맡긴 목록이 바로 다시 맞춰진다. */
function AlarmPrefsBox({ prefs, onPrefs, native }: { prefs: AlarmPrefs; onPrefs: (p: AlarmPrefs) => void; native: boolean }) {
  const range = { from: hhmm(prefs.from), to: hhmm(prefs.to) };
  const setRange = (v: TextRange) => {
    const from = parseHhmm(v.from);
    const to = parseHhmm(v.to);
    if (from !== null && to !== null && from < to) onPrefs({ ...prefs, from, to });
  };
  const chip = (on: boolean) => ({ borderColor: on ? "var(--ink)" : "var(--line)", color: on ? "var(--ink)" : "var(--muted)" });
  const windows: Array<[string, number, number]> = [
    ["하루 종일", 0, 24 * 60],
    ["07:00~23:00", 7 * 60, 23 * 60],
    ["08:00~22:00", 8 * 60, 22 * 60],
  ];
  const asks: Array<[string, number]> = [
    ["30분 전", 30],
    ["10분 전", 10],
    ["시작할 때", 0],
  ];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-[84px] shrink-0 text-[var(--muted)]">받는 시간</span>
        <TimePair value={range} onChange={setRange} />
        {windows.map(([label, from, to]) => (
          <button key={label} onClick={() => onPrefs({ ...prefs, from, to })} className="rounded-md border px-2 py-1 text-[11px] tnum" style={chip(prefs.from === from && prefs.to === to)}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        이 시간 밖의 칸 알림은 울리지 않습니다. 「남으세요?」는 받는 시간이 시작할 때로 미루고, 다음 날 확인자료 알림은 받는 시간 안쪽의 근무시간에만 울립니다. 사전신청을 넉넉히 올려 두었다면 새벽에 울리지 않게 시작을 늦춥니다.
      </p>
      {native && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-[84px] shrink-0 text-[var(--muted)]">「남으세요?」</span>
            {asks.map(([label, before]) => (
              <button key={label} onClick={() => onPrefs({ ...prefs, askBefore: before })} className="rounded-md border px-2 py-1 text-[11px]" style={chip(prefs.askBefore === before)}>
                {label}
              </button>
            ))}
            <span className="text-[11px] text-[var(--muted)]">토막(이어진 칸)이 시작하기 전에 묻습니다. 휴일 첫 토막은 30분 전.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-[84px] shrink-0 text-[var(--muted)]">소리</span>
            <button onClick={() => onPrefs({ ...prefs, sound: true })} className="rounded-md border px-2 py-1 text-[11px]" style={chip(prefs.sound)}>
              소리 · 진동
            </button>
            <button onClick={() => onPrefs({ ...prefs, sound: false })} className="rounded-md border px-2 py-1 text-[11px]" style={chip(!prefs.sound)}>
              무음
            </button>
            <span className="text-[11px] text-[var(--muted)]">무음이면 화면에 뜨기만 하고, 회의 · 방해 금지 중에는 알림 목록에만 쌓입니다.</span>
          </div>
        </>
      )}
    </div>
  );
}

function Checklist() {
  const items: Array<[string, string]> = [
    ["오늘", "브라우저에서 인사랑 팝업 차단 풀기"],
    ["오늘", "칸마다 [확인] 한 번(알림이 안 떠도 메인 [근무기록] 버튼으로)"],
    ["오늘", "퇴근확인에 한 일 적기"],
    ["오늘", "못 누른 칸 미기록 사유, 외출은 근무제외시간까지"],
    ["내일", "초과근무 확인자료를 그 날짜 한 건으로 올리기(다 눌렀어도 올림)"],
  ];
  return (
    <div className="rounded-lg px-3 py-2.5 text-[12px] leading-relaxed" style={{ background: "var(--wash)" }}>
      {items.map(([when, what]) => (
        <div key={what} className="flex gap-2">
          <span className="w-[32px] shrink-0 text-[var(--muted)]">{when}</span>
          <span>{what}</span>
        </div>
      ))}
    </div>
  );
}

function Sources() {
  return (
    <div className="flex flex-col gap-0.5">
      <span>근거(위에서부터 먼저)</span>
      <span>
        · 법령: 「{SOURCES.law.title}」, {SOURCES.law.date}
      </span>
      <span>
        · 지침: 「{SOURCES.guide.title}」, {SOURCES.guide.date}
      </span>
      <span>
        · 사용 안내: {SOURCES.usage.title}({SOURCES.usage.date}). 법령과 지침에 없는 화면 쓰는 법만 여기서 옮겼습니다.
      </span>
      <span>이 화면의 글은 근거를 다시 정리한 것이며 원문을 싣지 않습니다. 기관마다 다를 수 있는 것은 복무 담당 안내가 먼저입니다.</span>
    </div>
  );
}

function FaqList() {
  const [q, setQ] = useState("");
  const words = q.trim().split(/\s+/).filter(Boolean);
  const hits = FAQ.filter((f) => words.every((w) => `${f.q} ${f.a} ${f.group}`.includes(w)));
  const groups = [...new Set(hits.map((f) => f.group))];
  return (
    <section className="flex flex-col gap-3">
      <div className="rounded-lg border border-[var(--line)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
        <Sources />
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="찾을 말(예: 식사, 알림, 유연)"
        className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[13px]"
      />
      {hits.length === 0 && <p className="text-[12px] text-[var(--muted)]">찾은 것이 없습니다. 기관 복무 담당에게 물어보세요.</p>}
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1.5">
          <h2 className="text-[12px] font-semibold text-[var(--muted)]">{g}</h2>
          {hits
            .filter((f) => f.group === g)
            .map((f) => (
              <details key={f.q} className="rounded-lg border border-[var(--line)] px-3 py-2 text-[13px]">
                <summary className="cursor-pointer">{f.q}</summary>
                <p className="mt-1.5 leading-relaxed">{f.a}</p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  출처: {f.from}
                  {f.ref && ` ${f.ref}`}
                </p>
              </details>
            ))}
        </div>
      ))}
    </section>
  );
}
