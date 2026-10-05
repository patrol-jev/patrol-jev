"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { applyEvents, DEFAULT_PREFS, jobsOf, readPrefs, segmentsOf, type AlarmPrefs, type DayForm, type DayNote } from "@/core/overtime/alarms";
import { FAQ, SOURCES } from "@/core/overtime/faq";
import {
  dayLabel,
  hhmm,
  isWeekend,
  kstAt,
  kstToday,
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
import { isNativeAlarm, newDeviceId, pushReady, subscribe, syncJobs, takeEvents, unsubscribe, type PushReady } from "./push-client";

/**
 * 초과기록. 오늘 초과 시간을 넣으면 인사랑 「근무기록」에서 칸마다 할 일이 나온다.
 *
 * 판단은 `src/core/overtime/plan.ts` 한 곳에 있고, 이 화면은 그 값을 그릴 뿐이다.
 * 넣은 값(근무시간, 초과 시간, 비운 때, 날마다 할 일)은 이 기기에만 남는다.
 * 진동 알림을 켠 기기만 **울릴 시각과 칸 번호·날짜**를 서버에 맡긴다(`push-client.ts`).
 *
 * 다음 날 이 화면을 열면 전날 초과의 확인자료를 올릴 차례라는 카드가 맨 위에 뜬다.
 * 「올렸어요」를 누르면 카드와 그날 알림이 함께 사라진다.
 *
 * 무엇을 언제 울릴지(묻기 · 칸 · 요약 · 다음 날)는 `src/core/overtime/alarms.ts` 가 정한다.
 * 아이폰 앱에서 알림 단추(눌렀어요 · 안 남아요 …)로 답하면 앱이 쌓아 두었다가 이 화면이 열릴 때 받아 합친다.
 *
 * 색: 이 화면에는 Jev 값도 생성 모델의 글도 없다. 그래서 무지개빛도 회색 규칙도 쓰지 않는다.
 * 파랑은 [확인]을 누르는 칸, 주황은 사유를 쓰는 칸. 두 가지 뜻에만 쓴다.
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
      return at === null ? [] : [{ hour: s.hour, at }];
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
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6">
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
  const [holiday, setHoliday] = useState(() => opened?.holiday ?? isWeekend(date));
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
  const today = kstToday();

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
  const togglePressed = (hour: number) => {
    const note = shown[date];
    if (!note) return;
    const on = note.pressed?.includes(hour);
    const pressed = on ? (note.pressed ?? []).filter((h) => h !== hour) : [...(note.pressed ?? []), hour].sort((a, b) => a - b);
    setDays({ ...shown, [date]: { ...note, pressed, missed: (note.missed ?? []).filter((h) => h !== hour) } });
  };
  /** 「안 남아요」·「끝났어요」를 되돌린다. */
  const undoLeave = () => {
    const note = shown[date];
    if (!note) return;
    setDays({ ...shown, [date]: { ...note, left: [], endedAt: undefined } });
  };

  const pending = Object.entries(shown)
    .filter(([d, n]) => d < today && !n.done)
    .sort((a, b) => a[0].localeCompare(b[0]));

  // 다른 날로 옮기기 전에 지금 날의 고친 값을 굳힌다.
  const pickDate = (value: string) => {
    setDays(shown);
    setDate(value);
    const kept = shown[value];
    if (kept?.form) {
      setHoliday(kept.holiday ?? isWeekend(value));
      setBase(kept.form.base);
      setSpans(kept.form.spans);
      setGaps(kept.form.gaps);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setHoliday(isWeekend(value));
  };

  const clicks = plan.slots.filter((s) => s.action === "click").length;
  const note = saved ? shown[date] : undefined;
  // 「안 남아요」 한 토막과 「끝났어요」 뒤 칸. 알림이 울리지 않는 칸이라 흐리게 보인다.
  const offHours = new Set<number>();
  if (note) {
    for (const seg of segmentsOf(note)) {
      for (let h = seg.first; h < seg.until; h++) {
        if (note.left?.includes(seg.first) || (note.endedAt !== undefined && h * 60 >= note.endedAt)) offHours.add(h);
      }
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">초과기록</h1>
          <p className="text-[11px] text-[var(--muted)]">오늘 초과 시간을 넣으면 인사랑에서 누를 칸과 쓸 사유가 나옵니다.</p>
        </div>
        <nav className="ml-auto flex gap-1 rounded-lg p-0.5" style={{ background: "var(--wash)" }}>
          {(
            [
              ["today", "오늘"],
              ["steps", "순서"],
              ["faq", "묻고 답하기"],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="rounded-md px-3 py-1.5 text-[12px]"
              style={tab === key ? { background: "var(--paper)", color: "var(--ink)", fontWeight: 500 } : { color: "var(--muted)" }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex w-full flex-wrap gap-x-2 text-[10px] text-[var(--muted)]">
          <span>프로그램 · 모델 미사용</span>
          <span>· 넣은 값은 이 기기 밖으로 나가지 않습니다</span>
          <span>{native ? "(앱 알림은 이 폰이 직접 울립니다. 서버에도 맡기지 않습니다)" : "(진동 알림을 켜면 울릴 시각만 서버에 맡깁니다)"}</span>
          <span className="inline-flex items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={11} height={11} className="h-[11px] w-[11px] rounded-[2px]" />
            PJ
          </span>
        </div>
      </header>

      {pending.map(([d, n]) => (
        <div key={d} className="flex flex-col gap-2 rounded-lg border px-4 py-3 text-[13px]" style={{ borderColor: REASON }}>
          <div className="flex flex-wrap items-center gap-2">
            <b>{dayLabel(d)} 초과근무 확인자료를 올릴 차례입니다.</b>
            <button
              onClick={() => markDone(d)}
              className="ml-auto rounded-md border px-3 py-1 text-[12px]"
              style={{ borderColor: REASON, color: REASON }}
            >
              올렸어요
            </button>
          </div>
          <div className="text-[12px] leading-relaxed">
            {n.reasons.length > 0 ? (
              <>
                미기록 사유 쓸 칸:{" "}
                {n.reasons.map((r) => (
                  <span key={r.hour} className="mr-2 whitespace-nowrap">
                    {slotLabel(r.hour)} 「{r.reason}」
                  </span>
                ))}
              </>
            ) : (
              "미기록 사유 쓸 칸 없음(다 눌렀다면)"
            )}
            {(n.missed?.length ?? 0) > 0 && (
              <div>
                못 눌렀다고 한 칸(사유 씀): {n.missed!.map((h) => slotLabel(h)).join(", ")}
              </div>
            )}
            {(n.pressed?.length ?? 0) > 0 && (
              <div className="text-[var(--muted)]">
                눌렀다고 표시한 칸 {n.pressed!.length} / [확인] 칸 {n.clicks.length}
              </div>
            )}
            {n.exclusions.length > 0 && (
              <div>근무제외시간: {n.exclusions.map((r) => `${hhmm(r.from)}~${hhmm(r.to)}`).join(", ")}</div>
            )}
            <div className="text-[11px] text-[var(--muted)]">
              못 누른 칸이 더 있었다면 그 칸도 사유를 씁니다. 날짜별로 한 건씩 올립니다.
            </div>
          </div>
        </div>
      ))}

      <div className="rounded-lg px-4 py-3 text-[13px] leading-relaxed" style={{ background: "var(--wash)" }}>
        초과 신청이 걸린 시간에는 <b>한 시간 칸마다 인사랑 [근무기록] → [확인]</b>을 한 번 누릅니다. 지문과 퇴근확인은 그대로 따로 합니다.
        못 누른 칸은 <b>미기록 사유</b>를 쓰고, 확인자료는 <b>다음 날 날짜별로 한 건씩</b> 올립니다.
      </div>

      {tab === "today" && (
        <>
          <section className="flex flex-col gap-3 rounded-lg border border-[var(--line)] p-4">
            <Row label="날짜">
              <input type="date" value={date} onChange={(e) => pickDate(e.target.value)} className={FIELD} />
              <label className="inline-flex items-center gap-1.5 text-[12px]">
                <input type="checkbox" checked={holiday} onChange={(e) => setHoliday(e.target.checked)} />
                휴일(주말·공휴일)
              </label>
            </Row>

            {!holiday && (
              <Row label="내 근무시간">
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
              </Row>
            )}

            <Row label="초과 시간">
              <div className="flex w-full flex-col gap-2">
                {spans.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <TimePair value={s} onChange={(v) => setSpans(spans.map((x, j) => (j === i ? v : x)))} />
                    {spans.length > 1 && <Remove onClick={() => setSpans(spans.filter((_, j) => j !== i))} />}
                  </div>
                ))}
                <div className="flex flex-wrap gap-1">
                  {!holiday && (
                    <Add onClick={() => setSpans([...spans, { from: shift(base.from, -60), to: base.from }])}>출근 전 더하기</Add>
                  )}
                  <Add onClick={() => setSpans([...spans, { from: holiday ? "09:00" : base.to, to: holiday ? "18:00" : shift(base.to, 120) }])}>
                    {holiday ? "근무 토막 더하기" : "퇴근 후 더하기"}
                  </Add>
                </div>
              </div>
            </Row>

            <Row label="자리 비운 때">
              <div className="flex w-full flex-col gap-2">
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
            </Row>
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
              <div className="overflow-hidden rounded-lg border border-[var(--line)]">
                {plan.slots.map((s) => {
                  const at = nudgeAt(s);
                  const quiet = holiday && s.hour >= 9 && s.hour < 18;
                  const pressed = note?.pressed?.includes(s.hour) ?? false;
                  const off = offHours.has(s.hour);
                  const asked = address.date === date && address.slot === s.hour;
                  return (
                    <div
                      key={s.hour}
                      className="flex gap-3 border-b border-[var(--line)] px-3 py-2.5 last:border-b-0"
                      style={asked ? { background: "var(--wash)" } : off ? { opacity: 0.5 } : undefined}
                    >
                      <div className="w-[64px] shrink-0 text-[13px] font-medium tnum">{slotLabel(s.hour)}</div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        {s.action === "click" ? (
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
                        {quiet && s.action === "click" && <span className="text-[11px] text-[var(--muted)]">휴일 낮이라 알림이 안 뜹니다. 직접 누릅니다.</span>}
                        {s.notes.map((n) => (
                          <span key={n} className="text-[11px] text-[var(--muted)]">
                            {n}
                          </span>
                        ))}
                        {asked && s.action === "click" && !pressed && (
                          <span className="text-[11px]" style={{ color: REASON }}>
                            못 눌렀다면 이 칸은 미기록 사유를 씁니다. 그 시간에 무엇을 했는지 그대로 적습니다(식사 · 현장근무 · 개인용무 외출 등).
                          </span>
                        )}
                      </div>
                      {saved && s.action === "click" && (
                        <button
                          onClick={() => togglePressed(s.hour)}
                          className="h-fit shrink-0 rounded-md border px-2 py-1 text-[11px]"
                          style={pressed ? { borderColor: CLICK, background: CLICK, color: "#fff" } : { borderColor: CLICK, color: CLICK }}
                          aria-pressed={pressed}
                        >
                          {pressed ? "눌렀어요 ✓" : "눌렀어요"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="rounded-lg border border-[var(--line)] px-3 py-2.5 text-[12px] leading-relaxed">
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

            {plan.warnings.map((w) => (
              <p key={w} className="text-[12px]" style={{ color: REASON }}>
                {w}
              </p>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              {saved ? (
                <>
                  <span className="rounded-md border px-3 py-1.5 text-[12px]" style={{ borderColor: "var(--ink)" }}>
                    {dayLabel(date)} 남김
                  </span>
                  <span className="text-[11px] text-[var(--muted)]">다음 날 이 화면에 확인자료 카드가 뜹니다.</span>
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
                </>
              ) : (
                <>
                  <button
                    onClick={keepDay}
                    disabled={plan.slots.length === 0}
                    className="rounded-md border px-3 py-1.5 text-[12px] disabled:opacity-40"
                    style={{ borderColor: "var(--ink)" }}
                  >
                    이 날 초과로 남기기
                  </button>
                  <span className="text-[11px] text-[var(--muted)]">남긴 날만 알림이 울리고, 다음 날 확인자료 카드가 뜹니다.</span>
                </>
              )}
            </div>

            <Alarm prefs={prefs} onPrefs={setPrefs} ready={ready} native={native} on={alarm !== null} busy={busy} note={alarmNote} onOn={turnOn} onOff={turnOff} />

            <Checklist />
          </section>
        </>
      )}

      {tab === "steps" && <Steps />}
      {tab === "faq" && <FaqList />}

      <footer className="mt-auto flex flex-col gap-1.5 border-t border-[var(--line)] pt-3 text-[11px] leading-relaxed text-[var(--muted)]">
        <Sources />
        <p>
          이 화면은 칸을 대신 누르지 않습니다. 직접 누르도록 알려 줄 뿐입니다. ·{" "}
          <Link href="/" className="underline underline-offset-2">
            순찰일지
          </Link>{" "}
          ·{" "}
          <a href="https://github.com/patrol-jev/patrol-jev" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            GitHub
          </a>
        </p>
      </footer>
    </>
  );
}

const FIELD = "rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-[13px] tnum";

function shift(text: string, minutes: number): string {
  const m = parseHhmm(text);
  if (m === null) return text;
  return hhmm(Math.max(0, Math.min(24 * 60, m + minutes)));
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="w-[84px] shrink-0 pt-1 text-[12px] text-[var(--muted)]">{label}</div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
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
          남긴 날의 [확인] 칸마다, 그리고 다음 날 아침 확인자료 올릴 때 울립니다.
          {native && " 앱에서는 토막 10분 전에 「남으세요?」를 묻고, 끝나면 하루 요약을 보냅니다. 알림 단추로 「눌렀어요」 · 「10분 뒤」 · 「오늘은 끝났어요」를 고릅니다."}
        </span>
      </div>
      {on && <AlarmPrefsBox prefs={prefs} onPrefs={onPrefs} native={native} />}
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
        이 시간 밖의 칸 알림은 울리지 않습니다. 「남으세요?」와 다음 날 알림은 받는 시간이 시작할 때로 미룹니다. 사전신청을 넉넉히 올려 두었다면 새벽에 울리지 않게 시작을 늦춥니다.
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

function Steps() {
  const steps = [
    "초과근무 신청(사전 또는 사후). 기존과 같습니다.",
    "브라우저에서 인사랑 팝업 차단을 풉니다. 로그인이 끊기면 알림이 안 뜨니 알림만 믿지 않습니다.",
    "초과 시간에는 한 시간 칸마다 [근무기록] → [확인]을 한 번 누릅니다. 칸은 정각 기준이고 19:00 정각은 19~20 칸입니다.",
    "알림은 매시 30분쯤 뜹니다(사람마다 조금씩 다름). 휴일 09:00~18:00에는 알림이 없으니 직접 누릅니다.",
    "퇴근확인에서 한 일을 적습니다. 빠뜨리면 기존처럼 인정되지 않습니다.",
    "못 누른 칸(식사, 외출, 현장, 로그인 전)은 미기록 사유를 씁니다. 외출은 근무제외시간에도 넣습니다. 식사는 넣지 않습니다.",
    "다음 날 초과근무 확인자료를 날짜별로 한 건씩 올립니다. 근무기록은 여기에 함께 붙어 갑니다.",
    "반려되면 상세 화면 [근무기록조회]에서 재검토 사항을 보고 사유나 제외시간을 고쳐 다시 올립니다.",
  ];
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((s, i) => (
        <li key={s} className="flex gap-3 rounded-lg border border-[var(--line)] px-3 py-2.5 text-[13px] leading-relaxed">
          <span className="tnum font-semibold text-[var(--muted)]">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
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
