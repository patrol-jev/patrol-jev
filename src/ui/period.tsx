"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { IljiSlots } from "@/core/ilji-slots";
import { buildWeeklyIljiHwpx, PHOTO_RATIO, PHOTO_TABLES_PER_PAGE } from "@/core/hwpx/ilji";
import { buildPeriodHwpx, type PeriodPhoto } from "@/core/hwpx/period";
import {
  customPeriod,
  monthPeriod,
  periodText,
  shiftMonth,
  shiftWeek,
  summarisePeriod,
  weekPeriod,
  type Period,
  type PeriodSummary,
} from "@/core/period";
import { dayTag, slotsFromDay, weekDays } from "@/core/weekly";
import { downloadBytes, recropJpeg } from "@/ui/hwpx-photo";
import { loadPhotos, savePhotos, type DayPhotos } from "@/ui/photo-store";
import { readDays, readRuns, runsBetween, saveDay, summarise, type DayRecord } from "@/ui/usage";
import { WorkLine } from "@/ui/work-line";
import { keepUploadedForm } from "@/ui/form-bridge";
import { pickedLine, type Picked } from "@/ui/pick";

/**
 * 기간 보고서와 주간 일지. 이 브라우저에 남은 하루치 일지들을 한 주·한 달로 모아 글과 한글 파일로 낸다.
 *
 * 세는 일뿐이다. 모델을 부르지 않고, 서버로 아무것도 안 간다. 기록도 사진도 이 기기 것만 센다.
 * 결과 보고서는 주 단위로 내고, 달을 고르면 그 달의 주들이 그대로 합쳐진다.
 * 주간 일지는 그 주의 하루치를 날짜 차례로 이어 붙인 것이다(하루 2쪽, 사진은 1쪽). 부서 양식을 올려 둔
 * 브라우저에서는 그 양식으로도 나간다.
 * 폰을 바꾸면 「기록 내보내기」로 받은 파일을 새 폰에서 「가져오기」 하면 이어진다.
 */

type Kind = "month" | "week" | "custom";
type PhotoMode = "all" | "patrol" | "none";

/** 주간 일지를 부서 양식으로 짓는 길. 사이트 갈래에서만 값이 있고, 공개 갈래에서는 언제나 null 이다. */
export type WeekFormBuilder = () => { name: string; photoRatio: number; build: (days: IljiSlots[]) => { bytes: Uint8Array; note: string } } | null;
/** 결과 보고서를 부서 양식으로 짓는 길. 사무실 양식을 받아 둔 사이트 갈래 브라우저에서만 값이 있다. */
export type PeriodFormBuilder = () => {
  name: string;
  photoRatio: number;
  build: (input: { dong: string; officer?: string; summary: PeriodSummary; photos: PeriodPhoto[] }) => { bytes: Uint8Array; note: string };
} | null;

function subscribeNothing(): () => void {
  return () => undefined;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
}

export function PeriodReport({
  days,
  dong,
  unit,
  officer,
  weekForm,
  periodForm,
  onChanged,
  preset,
  onOther,
}: {
  days: DayRecord[];
  dong: string;
  unit: string;
  officer: string;
  weekForm?: WeekFormBuilder;
  periodForm?: PeriodFormBuilder;
  /** 가져오기로 기록이 바뀌었을 때. 화면이 다시 읽게. */
  onChanged: () => void;
  /** 뽑기(`src/ui/pick.tsx`)에서 다 고르고 왔다. 고르는 칸을 숨기고 결과 단추 하나만 낸다. 「자세히」로 전부 연다. */
  preset?: Picked;
  /** 「다른 것 뽑기」. */
  onOther?: () => void;
}) {
  const [kind, setKind] = useState<Kind>(preset?.kind ?? "week");
  const [month, setMonth] = useState(() => preset?.month ?? today().slice(0, 7));
  const [week, setWeek] = useState(() => preset?.week ?? today());
  const [from, setFrom] = useState(() => preset?.from ?? today().slice(0, 8) + "01");
  const [to, setTo] = useState(() => preset?.to ?? today());
  const [simple, setSimple] = useState(preset !== undefined);
  // 사진은 늘 자리마다 싣는다. 고르는 칸은 뺐다(09-26 사용자). 값은 남겨 두어 셈 규칙은 그대로다.
  const photoMode = "all" as PhotoMode;
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const period: Period = useMemo(
    () => (kind === "month" ? monthPeriod(month) : kind === "week" ? weekPeriod(week) : customPeriod(from, to)),
    [kind, month, week, from, to],
  );
  // 부서 양식과 사진일지는 브라우저에 붙은 뒤에만 읽을 수 있다(localStorage). 서버 렌더 때는 없다.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const summary = useMemo(() => summarisePeriod(days, period), [days, period]);
  // 이 기간에 도구가 한 일. 모델이 한 것 · 코드가 한 것 · 사람이 한 것을 보고서 카드에서 바로 본다. 이 기기의 사용 기록에서 센다.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- days 가 바뀌면 회차도 늘었을 수 있어 그때 다시 읽는다.
  const periodRuns = useMemo(() => (mounted ? runsBetween(readRuns(), period.from, period.to) : []), [mounted, period.from, period.to, days]);
  const work = useMemo(() => {
    const s = summarise(periodRuns);
    return { calls: s.modelCalls, learned: s.learnedLanes, unknown: s.unknownLanes, edits: s.edits };
  }, [periodRuns]);
  /** 낼 것이 하나도 없는가. 순찰이 없어도 사진일지가 있으면 보고서는 나간다. */
  const nothing = summary.days === 0 && summary.logs.length === 0;
  const text = useMemo(() => periodText(summary, dong), [summary, dong]);
  const inWeek = useMemo(() => weekDays(days, period), [days, period]);
  const toCheck = useMemo(() => summary.details.filter((line) => line.checks.length > 0), [summary]);
  const proofShots = summary.proof.inside + summary.proof.outside + summary.proof.unknown;
  /** 이 카드에서 양식을 올리면 하나 오른다. 양식 단추가 그 자리에서 바로 따라오게. */
  const [formVersion, setFormVersion] = useState(0);
  const form = useMemo(() => {
    void busy; // 양식을 새로 올리거나 지운 뒤 단추가 따라오게, 일이 끝날 때마다 다시 읽는다.
    void formVersion;
    return mounted && weekForm ? weekForm() : null;
  }, [mounted, weekForm, busy, formVersion]);
  const pForm = useMemo(() => {
    void busy;
    void formVersion;
    return mounted && periodForm ? periodForm() : null;
  }, [mounted, periodForm, busy, formVersion]);

  /** 카드 안에서 부서 양식 올리기. 주간 일지는 일지 양식, 결과 보고서는 결과 보고서 양식이다. 올리면 이 브라우저에 남는다. */
  const uploadForm = async (file: File) => {
    setBusy("양식");
    try {
      await keepUploadedForm(file, preset?.want === "weekly" ? "ilji" : "period");
      setFormVersion((n) => n + 1);
      onChanged();
      setSaid("양식을 올렸어요. 이제 부서 양식으로 나와요.");
    } catch (cause) {
      setSaid(cause instanceof Error ? cause.message : "양식을 읽지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), 4000);
    return () => clearTimeout(timer);
  }, [said]);

  /**
   * 세부내역 차례대로 사진을 모은다. 파일 쪽에서 란별 · 날짜별로 다시 줄을 세운다.
   * 보관한 사본은 통째라서 여기서 칸 비율로 자른다. 부서 양식이면 그 칸 비율, 아니면 기본 양식 비율이다.
   */
  const collectPhotos = async (ratio: number = PHOTO_RATIO): Promise<PeriodPhoto[]> => {
    if (photoMode === "none") return [];
    const out: PeriodPhoto[] = [];
    const cache = new Map<string, DayPhotos | null>();
    for (const line of summary.details) {
      if (photoMode === "patrol" && line.lane !== "waste_cleanup") continue;
      if (!cache.has(line.date)) cache.set(line.date, await loadPhotos(line.date));
      const item = cache.get(line.date)?.items[line.index];
      let before = item?.before ?? null;
      let after = item?.after ?? null;
      if (!before && !after) continue;
      before = before ? await recropJpeg(before, ratio) : null;
      after = after ? await recropJpeg(after, ratio) : null;
      out.push({ date: line.date, lane: line.lane, no: line.no, work: line.work, caption: line.address, note: "", pair: line.pair, before, after });
    }
    return out;
  };

  const makePeriodForm = async () => {
    if (!pForm) return;
    setBusy("부서 양식 보고서");
    try {
      const photos = await collectPhotos(pForm.photoRatio);
      const made = pForm.build({ dong, officer, summary, photos });
      const stem = pForm.name.replace(/\.hwpx?$/i, "");
      downloadBytes(made.bytes, `${stem} ${period.name} ${period.from}~${period.to}.hwpx`);
      setSaid(`부서 양식으로 냈습니다. ${made.note}`);
    } catch (cause) {
      setSaid(`파일을 만들지 못했습니다. ${cause instanceof Error ? cause.message : ""}`.trim());
    } finally {
      setBusy(null);
    }
  };

  const makeHwpx = async () => {
    setBusy("한글 파일");
    try {
      const photos = await collectPhotos();
      const bytes = buildPeriodHwpx({ dong, unit, officer, summary, photos });
      downloadBytes(bytes, `${dong || "○○동"} 현장 순찰 결과 보고서(기본 양식) ${period.from}~${period.to}.hwpx`);
      setSaid(photos.length > 0 ? `사진 ${photos.length}자리를 실었습니다.` : "사진 없이 냈습니다.");
    } catch (cause) {
      setSaid(`파일을 만들지 못했습니다. ${cause instanceof Error ? cause.message : ""}`.trim());
    } finally {
      setBusy(null);
    }
  };

  /** 그 주의 하루치들을 일지 자리로. 사진은 자리마다 셋까지(사진 쪽 한 쪽). 보관한 사본을 그 양식의 칸 비율로 자른다. */
  const weekSlots = async (ratio: number): Promise<IljiSlots[]> => {
    const out: IljiSlots[] = [];
    for (const day of inWeek) {
      const stored = await loadPhotos(day.date);
      let items = stored?.items ?? null;
      if (items) {
        items = await Promise.all(
          items.map(async (item) => ({
            before: item.before ? await recropJpeg(item.before, ratio) : null,
            after: item.after ? await recropJpeg(item.after, ratio) : null,
          })),
        );
      }
      out.push(slotsFromDay(day, items, officer, unit, PHOTO_TABLES_PER_PAGE));
    }
    return out;
  };

  const makeWeekly = async () => {
    if (inWeek.length === 0) return;
    setBusy("주간 일지");
    try {
      const slots = await weekSlots(PHOTO_RATIO);
      const bytes = buildWeeklyIljiHwpx(
        slots.map((one, i) => ({ slots: one, tag: dayTag(period, inWeek[i].date) })),
        `${dong || "○○동"} 현장 순찰 일지 ${period.name}`,
      );
      downloadBytes(bytes, `${dong || "○○동"} 현장 순찰 일지(주간·기본 양식) ${period.from}.hwpx`);
      setSaid(`${inWeek.length}일치를 이어 붙였습니다(날마다 2쪽).`);
    } catch (cause) {
      setSaid(`파일을 만들지 못했습니다. ${cause instanceof Error ? cause.message : ""}`.trim());
    } finally {
      setBusy(null);
    }
  };

  const makeWeeklyForm = async () => {
    if (inWeek.length === 0 || !form) return;
    setBusy("주간 부서 양식");
    try {
      const slots = await weekSlots(form.photoRatio);
      const made = form.build(slots);
      const stem = form.name.replace(/\.hwpx?$/i, "");
      downloadBytes(made.bytes, `${stem} ${period.name} ${period.from}.hwpx`);
      setSaid(`${inWeek.length}일치를 부서 양식으로 이어 붙였습니다. ${made.note}`);
    } catch (cause) {
      setSaid(`파일을 만들지 못했습니다. ${cause instanceof Error ? cause.message : ""}`.trim());
    } finally {
      setBusy(null);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => setSaid("복사했습니다.")).catch(() => setSaid("복사하지 못했습니다."));
  };

  /** 기록 전부(글·자리·사진)를 zip 하나로. 폰을 바꿀 때 가져가라고. */
  const exportAll = async () => {
    setBusy("내보내기");
    try {
      const all = readDays();
      const files: Record<string, Uint8Array> = { "days.json": strToU8(JSON.stringify({ version: 1, days: all }, null, 1)) };
      for (const day of all) {
        const stored = await loadPhotos(day.date);
        stored?.items.forEach((item, i) => {
          if (item.before) files[`photos/${day.date}/${i}-before.jpg`] = item.before;
          if (item.after) files[`photos/${day.date}/${i}-after.jpg`] = item.after;
        });
      }
      const zip = zipSync(files, { level: 0 });
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `patrol-jev 기록 ${today()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setSaid(`${all.length}일치를 내보냈습니다.`);
    } finally {
      setBusy(null);
    }
  };

  /** 내보낸 zip 을 들여온다. 같은 날짜는 들여온 것이 이긴다. */
  const importZip = async (file: File) => {
    setBusy("가져오기");
    try {
      const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const raw = zip["days.json"];
      if (!raw) {
        setSaid("기록 파일(days.json)이 없습니다.");
        return;
      }
      const parsed = JSON.parse(strFromU8(raw)) as { days?: DayRecord[] };
      const list = Array.isArray(parsed.days) ? parsed.days.filter((day) => day && /^\d{4}-\d{2}-\d{2}$/.test(day.date)) : [];
      for (const day of list) {
        saveDay(day);
        const items: DayPhotos["items"] = (day.spots ?? []).map((_, i) => ({
          before: zip[`photos/${day.date}/${i}-before.jpg`] ?? null,
          after: zip[`photos/${day.date}/${i}-after.jpg`] ?? null,
        }));
        if (items.some((item) => item.before || item.after)) await savePhotos({ date: day.date, items });
      }
      onChanged();
      setSaid(`${list.length}일치를 들여왔습니다.`);
    } catch {
      setSaid("파일을 읽지 못했습니다.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const chip = (on: boolean) => ({
    background: on ? "var(--ink)" : "var(--wash)",
    color: on ? "var(--paper)" : "var(--ink)",
    border: "1px solid var(--line)",
  });
  const input = { background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" };
  const primary = (off: boolean) => ({ background: "var(--ink)", color: "var(--paper)", opacity: off ? 0.5 : 1 });
  const secondary = (off: boolean) => ({ border: "1px solid var(--line)", color: "var(--ink)", opacity: off ? 0.5 : 1 });

  // 뽑기에서 왔으면 결과만. 고른 양식이 이 브라우저에 없으면 기본 양식으로 내고 그렇다고 적는다.
  if (simple && preset) {
    const weeklyPick = preset.want === "weekly";
    const wantOffice = preset.form === "office";
    const haveOffice = weeklyPick ? form !== null : pForm !== null;
    const off = busy !== null || (weeklyPick ? inWeek.length === 0 : nothing);
    const act = weeklyPick ? (wantOffice && form ? makeWeeklyForm : makeWeekly) : wantOffice && pForm ? makePeriodForm : makeHwpx;
    return (
      <section className="space-y-2.5 rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
        <p className="text-[13.5px] font-semibold">{pickedLine(preset)}</p>
        <p className="tnum text-[12px]">
          <b>{period.name}</b>
          {period.kind === "week" && <span className="text-[var(--muted)]"> ({period.label})</span>}
        </p>
        <p className="tnum text-[12px] text-[var(--muted)]">
          {weeklyPick ? (
            <>{inWeek.length > 0 ? `${inWeek.length}일치` : "이 주에는 기록이 없어요"}</>
          ) : (
            <>
              순찰 {summary.days}일 · 순찰사항 {summary.counts.patrol} · 계절특수 {summary.counts.seasonal} · 위험시설물 {summary.counts.facility}
              {summary.shots > 0 && <> · 사진 {summary.shots}장</>}
              {summary.logs.length > 0 && <> · 사진일지 {summary.logs.length}건</>}
            </>
          )}
        </p>
        {periodRuns.length > 0 && <WorkLine work={work} runs={periodRuns} head="이 기간에 도구가 한 일" />}
        {days.length === 0 && <p className="text-[11.5px] text-[var(--muted)]">이 기기에는 아직 지난 일지가 없어요. 아래에 사진을 올려 일지를 먼저 만들면 여기 숫자가 차요.</p>}
        {days.length > 0 && (weeklyPick ? inWeek.length === 0 : summary.days === 0) && <p className="text-[11.5px] text-[var(--muted)]">이 기간에는 일지가 없어요. 아래에 그 기간의 사진을 올리면 일지가 만들어지고 여기 숫자가 차요.</p>}
        {!haveOffice && (
          <p className="text-[11.5px] text-[var(--muted)]">
            {wantOffice ? "부서 양식이 이 브라우저에 없어 기본 양식으로 냅니다. " : "부서 양식이 아직 없어요. "}
            <label className="cursor-pointer underline underline-offset-2" style={{ color: "var(--ink)" }}>
              {busy === "양식" ? "읽는 중" : weeklyPick ? "부서 일지 양식 올리기" : "결과 보고서 양식 올리기"}
              <input
                type="file"
                accept=".hwpx"
                className="hidden"
                disabled={busy !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadForm(file);
                }}
              />
            </label>
            {" "}(.hwpx · 한 번 올리면 이 브라우저에 남아 다음부터 바로 나와요)
          </p>
        )}
        {!weeklyPick && toCheck.length > 0 && (
          <details className="rounded-lg px-2.5 py-1.5 text-[11.5px]" style={{ border: "1px solid var(--line)" }}>
            <summary className="cursor-pointer">
              <b>내기 전에 볼 자리 {toCheck.length}곳</b>
              <span className="text-[var(--muted)]"> · 그날 일지를 열어 고치면 여기에도 반영됩니다</span>
            </summary>
            <ul className="tnum mt-1.5 space-y-0.5">
              {toCheck.map((line) => (
                <li key={line.no}>
                  <span className="text-[var(--muted)]">연번 {line.no} · {line.date.slice(5)} · </span>
                  {line.address} <span className="text-[var(--muted)]">·</span> {line.checks.join(", ")}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void act()} disabled={off} className="rounded-full px-5 py-2.5 text-[13px] font-semibold" style={primary(off)}>
            <span className={wantOffice && haveOffice ? "iri-text" : ""}>{busy ? "만드는 중" : `${pickedLine(preset)} 받기`}</span>
          </button>
          {!wantOffice && haveOffice && (
            // 기본 양식을 골랐어도 부서 양식이 있으면 한 단추로. 보고서 탭까지 안 내려가게.
            <button type="button" onClick={() => void (weeklyPick ? makeWeeklyForm() : makePeriodForm())} disabled={off} className="rounded-full px-4 py-2 text-[12.5px] font-semibold" style={secondary(off)}>
              <span className="iri-text">부서 양식 받기</span>
            </button>
          )}
          {!weeklyPick && (
            <button type="button" onClick={copy} disabled={nothing} className="rounded-full px-3 py-2 text-[12px]" style={secondary(nothing)}>
              글 복사
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-[var(--muted)]">
          <button type="button" onClick={() => setSimple(false)} className="underline underline-offset-2">
            자세히
          </button>
          {onOther && (
            <button type="button" onClick={onOther} className="underline underline-offset-2">
              다른 것 뽑기
            </button>
          )}
        </div>
        {said && <p className="text-[11.5px]">{said}</p>}
      </section>
    );
  }

  return (
    <section className="space-y-2.5 rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
      <header className="flex flex-wrap items-center gap-2">
        <b className="text-[12.5px]">기간 보고서 · 주간 일지</b>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {(["week", "month", "custom"] as Kind[]).map((one) => (
          <button key={one} type="button" onClick={() => setKind(one)} className="rounded px-2 py-0.5" style={chip(kind === one)}>
            {one === "month" ? "달" : one === "week" ? "주" : "직접"}
          </button>
        ))}
        {preset && (
          <button type="button" onClick={() => setSimple(true)} className="ml-auto text-[11.5px] text-[var(--muted)] underline underline-offset-2">
            간단히
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {kind === "month" && (
          <>
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="rounded px-2 py-0.5" style={input}>이전</button>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="tnum rounded px-2 py-0.5" style={input} />
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="rounded px-2 py-0.5" style={input}>다음</button>
          </>
        )}
        {kind === "week" && (
          <>
            <button type="button" onClick={() => setWeek(shiftWeek(week, -1))} className="rounded px-2 py-0.5" style={input}>이전 주</button>
            <input type="date" value={week} onChange={(e) => e.target.value && setWeek(e.target.value)} className="tnum rounded px-2 py-0.5" style={input} />
            <button type="button" onClick={() => setWeek(shiftWeek(week, 1))} className="rounded px-2 py-0.5" style={input}>다음 주</button>
          </>
        )}
        {kind === "custom" && (
          <>
            <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="tnum rounded px-2 py-0.5" style={input} />
            <span className="text-[var(--muted)]">~</span>
            <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="tnum rounded px-2 py-0.5" style={input} />
          </>
        )}
      </div>

      <p className="tnum text-[12px]">
        <b>{period.name}</b>
        {period.kind === "week" && <span className="text-[var(--muted)]"> ({period.label})</span>}
        <span className="text-[var(--muted)]"> · </span>
        순찰 {summary.days}일 · 순찰사항 {summary.counts.patrol} · 계절특수 {summary.counts.seasonal} · 위험시설물 {summary.counts.facility}
        {summary.shots > 0 && <> · 사진 {summary.shots}장</>}
        {summary.requested > 0 && <> · 정비요청 {summary.requested}</>}
      </p>

      {periodRuns.length > 0 && <WorkLine work={work} runs={periodRuns} head="이 기간에 도구가 한 일" />}

      {summary.logs.length > 0 && (
        <p className="tnum text-[11.5px] text-[var(--muted)]">
          사진일지 {summary.logs.length}건 · 사진 {summary.logs.reduce((n, log) => n + log.photos, 0)}장
          {summary.categories.filter((c) => c.fromLogs > 0).map((c) => (
            <span key={`${c.group}${c.item}`}> · {c.group} {c.fromLogs}</span>
          ))}
          {summary.logsUnfiled > 0 && <b className="text-[var(--ink)]"> · 항목을 안 정한 건 {summary.logsUnfiled}(사진만 실립니다)</b>}
        </p>
      )}

      {proofShots > 0 && (
        <p className="tnum text-[11.5px] text-[var(--muted)]">
          사진 날짜 · 기간 안 {summary.proof.inside}장
          {summary.proof.outside > 0 && <b className="text-[var(--ink)]"> · 기간 밖 {summary.proof.outside}장</b>}
          {summary.proof.unknown > 0 && <> · 모름 {summary.proof.unknown}장</>}
        </p>
      )}

      {toCheck.length > 0 && (
        <details className="rounded-lg px-2.5 py-1.5 text-[11.5px]" style={{ border: "1px solid var(--line)" }}>
          <summary className="cursor-pointer">
            <b>내기 전에 볼 자리 {toCheck.length}곳</b>
            <span className="text-[var(--muted)]"> · 그날 일지를 열어 고치면 여기에도 반영됩니다</span>
          </summary>
          <ul className="tnum mt-1.5 space-y-0.5">
            {toCheck.map((line) => (
              <li key={line.no}>
                <span className="text-[var(--muted)]">연번 {line.no} · {line.date.slice(5)} · </span>
                {line.address} <span className="text-[var(--muted)]">·</span> {line.checks.join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="ml-auto" />
        <button type="button" onClick={copy} disabled={nothing} className="rounded-md px-3 py-1.5 text-[12px] font-medium" style={secondary(nothing)}>
          글 복사
        </button>
        <button
          type="button"
          onClick={() => void makeHwpx()}
          disabled={busy !== null || nothing}
          className={`rounded-md px-3 py-1.5 text-[12px] ${pForm ? "font-medium" : "font-semibold"}`}
          style={pForm ? secondary(busy !== null || nothing) : primary(busy !== null || nothing)}
        >
          {busy === "한글 파일" ? "만드는 중" : pForm ? "결과 보고서(기본 양식)" : "결과 보고서(.hwpx)"}
        </button>
        {pForm && (
          <button
            type="button"
            onClick={() => void makePeriodForm()}
            disabled={busy !== null || summary.days === 0}
            className="rounded-md px-3 py-1.5 text-[12px] font-semibold"
            style={primary(busy !== null || summary.days === 0)}
            title={pForm.name}
          >
            {/* 글자만 Jev 빛. 결과 보고서가 진짜 노가다였던 자리라 여기 하나만 칠한다(09-28 사용자). 주간 일지는 안 칠한다. */}
            <span className="iri-text">{busy === "부서 양식 보고서" ? "만드는 중" : "결과 보고서(부서 양식)"}</span>
          </button>
        )}
      </div>

      {kind === "week" && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <span className="text-[var(--muted)]">
            주간 일지 · {inWeek.length > 0 ? `${inWeek.length}일치` : "이 주에는 기록이 없습니다"}
          </span>
          <span className="ml-auto" />
          <button
            type="button"
            onClick={() => void makeWeekly()}
            disabled={busy !== null || inWeek.length === 0}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium"
            style={secondary(busy !== null || inWeek.length === 0)}
          >
            {busy === "주간 일지" ? "만드는 중" : "주간 일지(기본 양식)"}
          </button>
          {form && (
            <button
              type="button"
              onClick={() => void makeWeeklyForm()}
              disabled={busy !== null || inWeek.length === 0}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold"
              style={primary(busy !== null || inWeek.length === 0)}
              title={form.name}
            >
              {busy === "주간 부서 양식" ? "만드는 중" : "주간 일지(부서 양식)"}
            </button>
          )}
        </div>
      )}

      <pre className="tnum max-h-56 overflow-auto whitespace-pre-wrap rounded-lg p-2.5 text-[11px] leading-relaxed" style={{ background: "var(--wash)", color: "var(--ink)" }}>
        {text}
      </pre>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
        <button type="button" onClick={() => void exportAll()} disabled={busy !== null} className="rounded px-2 py-0.5" style={input}>
          기록 내보내기(zip)
        </button>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={busy !== null} className="rounded px-2 py-0.5" style={input}>
          가져오기
        </button>
        <input ref={fileInput} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importZip(f); }} />
        {said && <span className="text-[var(--ink)]">{said}</span>}
      </div>
    </section>
  );
}
