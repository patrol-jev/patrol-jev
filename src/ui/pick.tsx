"use client";

import { useState } from "react";
import { monthPeriod, shiftMonth, shiftWeek, weekPeriod } from "@/core/period";

/**
 * 뽑기. 홈의 첫 화면이다. 한 걸음에 하나만 고른다.
 *
 *   무엇을 뽑나(순찰일지 · 결과 보고서 · 주간 일지) → 어느 양식으로(부서 · 기본, 부서 양식이 있을 때만) → 어느 기간(보고서 · 주간일 때만) → 끝.
 *
 * 고르는 일을 여기서 다 끝내고, 그 뒤 화면은 결과만 낸다. 보고서 탭에서 기본 양식 · 부서 양식 · 주 · 달을 고르다 막히던 자리를
 * 앞으로 당긴 것이다(2026-10-13 사용자 피드백). PJ 의 한 마디가 걸음마다 무엇을 할지 말한다. 모델을 부르지 않는다.
 */

export type Want = "ilji" | "period" | "weekly";
export type FormPick = "basic" | "office";
export type PeriodKind = "week" | "month" | "custom";

export interface Picked {
  want: Want;
  form: FormPick;
  /** 보고서 · 주간 일지의 기간. 순찰일지(오늘 사진)에는 없다. */
  kind?: PeriodKind;
  month?: string;
  week?: string;
  from?: string;
  to?: string;
}

export const WANT_LABEL: Record<Want, string> = { ilji: "순찰일지", period: "결과 보고서", weekly: "주간 일지" };
export const FORM_LABEL: Record<FormPick, string> = { basic: "기본 양식", office: "부서 양식" };

/** 고른 것 한 줄. 「결과 보고서 · 부서 양식 · 10월 2주」. */
export function pickedLine(p: Picked): string {
  const bits = [WANT_LABEL[p.want], FORM_LABEL[p.form]];
  if (p.kind === "month" && p.month) bits.push(monthPeriod(p.month).name);
  else if (p.kind === "week" && p.week) bits.push(weekPeriod(p.week).name);
  else if (p.kind === "custom" && p.from && p.to) bits.push(`${p.from} ~ ${p.to}`);
  return bits.join(" · ");
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
}

type Step = "want" | "form" | "period";

export function Pick({
  officeIlji,
  officePeriod,
  hasDays,
  onPick,
}: {
  /** 부서 일지 양식이 이 브라우저에 있나(이름). 없으면 양식 걸음을 건너뛴다. */
  officeIlji: string | null;
  /** 부서 결과 보고서 양식이 있나(이름). */
  officePeriod: string | null;
  /** 지난 기록이 하루라도 있나. 없어도 고를 수는 있고, 없다고 한 줄 적는다. */
  hasDays: boolean;
  onPick: (picked: Picked) => void;
}) {
  const [want, setWant] = useState<Want | null>(null);
  const [form, setForm] = useState<FormPick | null>(null);
  const [from, setFrom] = useState(() => `${today().slice(0, 8)}01`);
  const [to, setTo] = useState(today);

  const officeOf = (w: Want) => (w === "ilji" || w === "weekly" ? officeIlji : officePeriod);
  const step: Step = want === null ? "want" : form === null ? "form" : "period";

  /** 무엇을 뽑을지 골랐다. 부서 양식이 없으면 기본 양식으로 바로 간다. 순찰일지는 기간이 없으니 그걸로 끝. */
  const chooseWant = (w: Want) => {
    setWant(w);
    if (!officeOf(w)) {
      setForm("basic");
      if (w === "ilji") onPick({ want: w, form: "basic" });
    }
  };
  const chooseForm = (f: FormPick) => {
    setForm(f);
    if (want === "ilji") onPick({ want, form: f });
  };
  const finish = (k: PeriodKind, value: string) => {
    if (!want || !form) return;
    if (k === "month") onPick({ want, form, kind: "month", month: value });
    else if (k === "week") onPick({ want, form, kind: "week", week: value });
    else onPick({ want, form, kind: "custom", from, to });
  };
  /** 한 걸음 앞으로. 양식 걸음을 건너뛴 길이면 처음으로. */
  const back = () => {
    if (step === "period" && want && officeOf(want)) {
      setForm(null);
      return;
    }
    setWant(null);
    setForm(null);
  };

  const now = today();
  const line =
    step === "want"
      ? { text: "무엇을 뽑으시겠어요?", sub: "하나만 고르세요. 그다음은 사진이나 기간만 있으면 바로 나와요." }
      : step === "form"
        ? { text: `${WANT_LABEL[want!]}를 어느 양식으로 뽑을까요?`, sub: "부서 양식은 이 브라우저에 받아 둔 양식 그대로, 기본 양식은 PJ 의 양식이에요." }
        : want === "weekly"
          ? { text: "어느 주의 일지를 묶을까요?", sub: "그 주의 하루치를 날짜 차례로 이어 붙여요." }
          : { text: "어느 기간의 보고서인가요?", sub: "그 기간에 이 기기에서 만든 일지를 모아 바로 세요." };

  return (
    <section className="pk-stage flex flex-col items-center gap-4 rounded-[28px] px-4 pb-6 pt-6" style={{ background: "var(--wash)" }}>
      <div className="w-full max-w-[520px] rounded-[20px] px-4 py-3.5" style={{ background: "var(--paper)", border: "1px solid var(--line)" }} aria-live="polite">
        <p className="flex items-center gap-1.5 text-[10.5px] text-[var(--muted)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={11} height={11} className="h-[11px] w-[11px] rounded-[2px]" />
          PJ
        </p>
        <p className="mt-1 text-[15px] font-semibold leading-snug">{line.text}</p>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{line.sub}</p>
      </div>

      {step === "want" && (
        <div className="grid w-full max-w-[520px] grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Card title="순찰일지" body="오늘 찍은 사진으로 하루 일지" thumb="ilji" onClick={() => chooseWant("ilji")} />
          <Card title="결과 보고서" body="한 주 · 한 달의 실적을 모아서" thumb="period" onClick={() => chooseWant("period")} />
          <Card title="주간 일지" body="한 주의 하루치를 이어 붙여" thumb="weekly" onClick={() => chooseWant("weekly")} />
        </div>
      )}
      {step === "want" && !hasDays && (
        <p className="max-w-[520px] text-center text-[11.5px] text-[var(--muted)]">
          이 기기에는 아직 지난 일지가 없어요. 보고서와 주간 일지는 순찰일지를 남긴 날부터 숫자가 차요.
        </p>
      )}

      {step === "form" && want && (
        <div className="grid w-full max-w-[520px] grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Card title="부서 양식" body={officeOf(want) ?? ""} thumb="office" onClick={() => chooseForm("office")} accent />
          <Card title="기본 양식" body="PJ 가 만드는 양식. 어디서나 열려요" thumb={want === "period" ? "period" : "ilji"} onClick={() => chooseForm("basic")} />
        </div>
      )}

      {step === "period" && want && (
        <div className="flex w-full max-w-[520px] flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Chip label="이번 주" sub={weekPeriod(now).name} onClick={() => finish("week", now)} />
            <Chip label="지난 주" sub={weekPeriod(shiftWeek(now, -1)).name} onClick={() => finish("week", shiftWeek(now, -1))} />
            {want === "period" && (
              <>
                <Chip label="이번 달" sub={monthPeriod(now.slice(0, 7)).name} onClick={() => finish("month", now.slice(0, 7))} />
                <Chip label="지난 달" sub={monthPeriod(shiftMonth(now.slice(0, 7), -1)).name} onClick={() => finish("month", shiftMonth(now.slice(0, 7), -1))} />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 text-[12px]" style={{ background: "var(--paper)", border: "1px solid var(--line)" }}>
            <span className="text-[var(--muted)]">{want === "weekly" ? "다른 주" : "직접"}</span>
            {want === "weekly" ? (
              <input type="date" aria-label="그 주의 날" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="tnum rounded px-2 py-1" style={{ background: "var(--wash)", border: "1px solid var(--line)" }} />
            ) : (
              <>
                <input type="date" aria-label="시작" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="tnum rounded px-2 py-1" style={{ background: "var(--wash)", border: "1px solid var(--line)" }} />
                <span className="text-[var(--muted)]">~</span>
                <input type="date" aria-label="끝" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="tnum rounded px-2 py-1" style={{ background: "var(--wash)", border: "1px solid var(--line)" }} />
              </>
            )}
            <button
              type="button"
              disabled={want === "period" && from > to}
              onClick={() => (want === "weekly" ? finish("week", to) : finish("custom", ""))}
              className="ml-auto rounded-full px-3 py-1 text-[12px] font-semibold disabled:opacity-40"
              style={{ background: "var(--ink)", color: "var(--paper)" }}
            >
              {want === "weekly" ? "이 주로" : "이 기간으로"}
            </button>
          </div>
        </div>
      )}

      {step !== "want" && (
        <button type="button" onClick={back} className="text-[11.5px] text-[var(--muted)] underline underline-offset-2">
          앞으로
        </button>
      )}
    </section>
  );
}

/** 양식 카드. 작은 그림(썸네일)과 이름. */
function Card({ title, body, thumb, onClick, disabled, accent }: { title: string; body: string; thumb: Thumb; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition-transform active:scale-[0.98] disabled:opacity-45 sm:flex-col sm:items-stretch sm:gap-2"
      style={{ background: "var(--paper)", border: `1px solid ${accent ? "var(--ink)" : "var(--line)"}` }}
    >
      <FormThumb kind={thumb} />
      <span className="min-w-0">
        <b className={`block text-[13.5px] ${accent ? "iri-text" : ""}`}>{title}</b>
        <span className="block truncate text-[11.5px] text-[var(--muted)]">{body}</span>
      </span>
    </button>
  );
}

function Chip({ label, sub, onClick }: { label: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl px-3 py-2.5 text-left transition-transform active:scale-[0.98]" style={{ background: "var(--paper)", border: "1px solid var(--line)" }}>
      <b className="block text-[13px]">{label}</b>
      <span className="tnum block text-[11px] text-[var(--muted)]">{sub}</span>
    </button>
  );
}

type Thumb = "ilji" | "period" | "weekly" | "office";

/**
 * 양식의 작은 그림. 종이 한 장에 그 양식의 뼈대만 선으로.
 *   일지 = 머리띠 셋과 글줄 · 아래에 사진 두 칸(전 · 후)
 *   보고서 = 제목 · 숫자 표(구분 × 내용)
 *   주간 = 종이 석 장이 겹침
 *   부서 = 종이에 도장 자리 셋(결재 칸)
 */
function FormThumb({ kind }: { kind: Thumb }) {
  const stroke = "var(--muted)";
  const page = <rect x="6" y="4" width="36" height="48" rx="2" fill="var(--paper)" stroke={stroke} strokeWidth="1.2" />;
  return (
    <svg width="48" height="56" viewBox="0 0 48 56" aria-hidden className="shrink-0">
      {kind === "weekly" && (
        <>
          <rect x="12" y="1" width="30" height="40" rx="2" fill="var(--wash)" stroke={stroke} strokeWidth="1" />
          <rect x="9" y="3" width="30" height="40" rx="2" fill="var(--wash)" stroke={stroke} strokeWidth="1" />
        </>
      )}
      {kind === "weekly" ? <rect x="6" y="6" width="30" height="40" rx="2" fill="var(--paper)" stroke={stroke} strokeWidth="1.2" /> : page}
      {kind === "ilji" && (
        <>
          <rect x="10" y="9" width="28" height="3.5" fill={stroke} opacity="0.6" />
          <line x1="10" y1="17" x2="34" y2="17" stroke={stroke} strokeWidth="1" />
          <line x1="10" y1="21" x2="30" y2="21" stroke={stroke} strokeWidth="1" />
          <rect x="10" y="26" width="28" height="3.5" fill={stroke} opacity="0.6" />
          <line x1="10" y1="34" x2="32" y2="34" stroke={stroke} strokeWidth="1" />
          <rect x="10" y="39" width="12" height="9" fill="var(--wash)" stroke={stroke} strokeWidth="1" />
          <rect x="26" y="39" width="12" height="9" fill="var(--wash)" stroke={stroke} strokeWidth="1" />
        </>
      )}
      {kind === "period" && (
        <>
          <rect x="13" y="9" width="22" height="3.5" fill={stroke} opacity="0.6" />
          <rect x="10" y="17" width="28" height="30" fill="none" stroke={stroke} strokeWidth="1" />
          <line x1="10" y1="24" x2="38" y2="24" stroke={stroke} strokeWidth="1" />
          <line x1="10" y1="31" x2="38" y2="31" stroke={stroke} strokeWidth="1" />
          <line x1="10" y1="38" x2="38" y2="38" stroke={stroke} strokeWidth="1" />
          <line x1="20" y1="17" x2="20" y2="47" stroke={stroke} strokeWidth="1" />
          <line x1="30" y1="17" x2="30" y2="47" stroke={stroke} strokeWidth="1" />
        </>
      )}
      {kind === "weekly" && (
        <>
          <rect x="9" y="11" width="18" height="3" fill={stroke} opacity="0.6" />
          <line x1="9" y1="19" x2="31" y2="19" stroke={stroke} strokeWidth="1" />
          <line x1="9" y1="23" x2="28" y2="23" stroke={stroke} strokeWidth="1" />
          <line x1="9" y1="27" x2="31" y2="27" stroke={stroke} strokeWidth="1" />
          <rect x="9" y="33" width="9" height="8" fill="var(--wash)" stroke={stroke} strokeWidth="1" />
          <rect x="22" y="33" width="9" height="8" fill="var(--wash)" stroke={stroke} strokeWidth="1" />
        </>
      )}
      {kind === "office" && (
        <>
          <rect x="22" y="8" width="5" height="6" fill="none" stroke={stroke} strokeWidth="1" />
          <rect x="28" y="8" width="5" height="6" fill="none" stroke={stroke} strokeWidth="1" />
          <rect x="34" y="8" width="5" height="6" fill="none" stroke={stroke} strokeWidth="1" />
          <rect x="10" y="18" width="28" height="3.5" fill={stroke} opacity="0.6" />
          <rect x="10" y="25" width="28" height="22" fill="none" stroke={stroke} strokeWidth="1" />
          <line x1="10" y1="32" x2="38" y2="32" stroke={stroke} strokeWidth="1" />
          <line x1="10" y1="39" x2="38" y2="39" stroke={stroke} strokeWidth="1" />
          <line x1="19" y1="25" x2="19" y2="47" stroke={stroke} strokeWidth="1" />
        </>
      )}
    </svg>
  );
}
