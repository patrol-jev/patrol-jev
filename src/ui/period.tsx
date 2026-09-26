"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { IljiSlots } from "@/core/ilji-slots";
import { buildWeeklyIljiHwpx, PHOTO_TABLES_PER_PAGE } from "@/core/hwpx/ilji";
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
} from "@/core/period";
import { dayTag, slotsFromDay, weekDays } from "@/core/weekly";
import { downloadBytes, recropJpeg } from "@/ui/hwpx-photo";
import { loadPhotos, savePhotos, type DayPhotos } from "@/ui/photo-store";
import { readDays, saveDay, type DayRecord } from "@/ui/usage";

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
  onChanged,
}: {
  days: DayRecord[];
  dong: string;
  unit: string;
  officer: string;
  weekForm?: WeekFormBuilder;
  /** 가져오기로 기록이 바뀌었을 때. 화면이 다시 읽게. */
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<Kind>("week");
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [week, setWeek] = useState(() => today());
  const [from, setFrom] = useState(() => today().slice(0, 8) + "01");
  const [to, setTo] = useState(() => today());
  // 사진은 늘 자리마다 싣는다. 고르는 칸은 뺐다(09-26 사용자). 값은 남겨 두어 셈 규칙은 그대로다.
  const photoMode = "all" as PhotoMode;
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const period: Period = useMemo(
    () => (kind === "month" ? monthPeriod(month) : kind === "week" ? weekPeriod(week) : customPeriod(from, to)),
    [kind, month, week, from, to],
  );
  const summary = useMemo(() => summarisePeriod(days, period), [days, period]);
  const text = useMemo(() => periodText(summary, dong), [summary, dong]);
  const inWeek = useMemo(() => weekDays(days, period), [days, period]);
  // 부서 양식은 브라우저에 붙은 뒤에만 읽을 수 있다(localStorage). 서버 렌더 때는 없다.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const form = useMemo(() => {
    void busy; // 양식을 새로 올리거나 지운 뒤 단추가 따라오게, 일이 끝날 때마다 다시 읽는다.
    return mounted && weekForm ? weekForm() : null;
  }, [mounted, weekForm, busy]);

  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), 4000);
    return () => clearTimeout(timer);
  }, [said]);

  /** 세부내역 차례대로 사진을 모은다. 파일 쪽에서 란별 · 날짜별로 다시 줄을 세운다. */
  const collectPhotos = async (): Promise<PeriodPhoto[]> => {
    if (photoMode === "none") return [];
    const out: PeriodPhoto[] = [];
    const cache = new Map<string, DayPhotos | null>();
    for (const line of summary.details) {
      if (photoMode === "patrol" && line.lane !== "waste_cleanup") continue;
      if (!cache.has(line.date)) cache.set(line.date, await loadPhotos(line.date));
      const item = cache.get(line.date)?.items[line.index];
      const before = item?.before ?? null;
      const after = item?.after ?? null;
      if (!before && !after) continue;
      out.push({ date: line.date, lane: line.lane, no: line.no, work: line.work, caption: line.address, note: "", pair: line.pair, before, after });
    }
    return out;
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

  /** 그 주의 하루치들을 일지 자리로. 사진은 자리마다 셋까지(사진 쪽 한 쪽). 부서 양식이면 그 칸 비율로 다시 자른다. */
  const weekSlots = async (ratio: number | null): Promise<IljiSlots[]> => {
    const out: IljiSlots[] = [];
    for (const day of inWeek) {
      const stored = await loadPhotos(day.date);
      let items = stored?.items ?? null;
      if (items && ratio) {
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
      const slots = await weekSlots(null);
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
        <span className="mx-1 text-[var(--line)]">|</span>
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

      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="ml-auto" />
        <button type="button" onClick={copy} disabled={summary.days === 0} className="rounded-md px-3 py-1.5 text-[12px] font-medium" style={secondary(summary.days === 0)}>
          글 복사
        </button>
        <button
          type="button"
          onClick={() => void makeHwpx()}
          disabled={busy !== null || summary.days === 0}
          className="rounded-md px-3 py-1.5 text-[12px] font-semibold"
          style={primary(busy !== null || summary.days === 0)}
        >
          {busy === "한글 파일" ? "만드는 중" : "결과 보고서(.hwpx)"}
        </button>
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
