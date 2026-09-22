"use client";

import type { Lane } from "@/core/lanes";
import { LANES, LANE_ORDER } from "@/core/lanes";

/**
 * Jev 가 한 일을 보이게 하는 부품들.
 *
 * 이 도구가 감추지 않는 것 세 가지 — **고른 값이 아니라 분포 전체**,
 * **걸린 시간**, 그리고 **못 정했다는 사실**. 셋 다 화면에 숫자로 나온다.
 */

/** 프리미티브 이름표. 어떤 종류의 질문이 이 답을 냈는지 숨기지 않는다. */
export function Chip({ kind }: { kind: "Choice" | "Noul" | "Score" }) {
  return <span className="chip">{kind}</span>;
}

export function Ms({ ms, of }: { ms: number; of: "jev" | "gen" }) {
  const text = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  return (
    <span className={`tnum text-[11px] ${of === "jev" ? "iri-text font-semibold" : "text-[var(--muted)]"}`}>
      {text}
    </span>
  );
}

const SHORT: Record<Lane, string> = {
  waste_cleanup: "순찰",
  flood_season: "계절",
  risk_facility: "위험",
  none_of_these: "해당없음",
};

/**
 * 네 갈래의 확률을 **전부** 보인다.
 * 이긴 갈래만 무지개빛이고 나머지는 회색이다. 못 정했으면 넷 다 회색으로 남는다.
 */
export function ChoiceBar({
  probabilities,
  decided,
  chosen,
  ms,
}: {
  probabilities: Record<Lane, number>;
  decided: boolean;
  chosen: Lane | null;
  ms: number;
}) {
  const total = LANE_ORDER.reduce((sum, lane) => sum + (probabilities[lane] || 0), 0) || 1;

  return (
    <div className="land">
      <div className="flex items-center gap-2">
        <Chip kind="Choice" />
        <span className={`text-[13px] font-medium ${decided ? "" : "text-[var(--muted)]"}`}>
          {decided && chosen ? LANES[chosen] : "모르겠음"}
        </span>
        <span className="ml-auto">
          <Ms ms={ms} of="jev" />
        </span>
      </div>

      <div
        className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--wash)" }}
        aria-hidden
      >
        {LANE_ORDER.map((lane) => {
          const share = (probabilities[lane] || 0) / total;
          if (share <= 0) return null;
          const win = decided && lane === chosen;
          return (
            <div
              key={lane}
              className={win ? "iri" : ""}
              style={{
                width: `${share * 100}%`,
                background: win ? undefined : "var(--gen)",
                opacity: win ? 1 : 0.45,
                borderRight: "1px solid var(--paper)",
              }}
            />
          );
        })}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {LANE_ORDER.map((lane) => {
          const win = decided && lane === chosen;
          return (
            <span key={lane} className="tnum text-[10px] text-[var(--muted)]">
              {SHORT[lane]}{" "}
              <b className={win ? "iri-text" : "text-[var(--ink)] opacity-60"}>
                {(probabilities[lane] || 0).toFixed(2)}
              </b>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 예/아니오 확률 하나. **문턱을 눈금으로 같이 그린다** —
 * 왜 이쪽으로 넘어갔는지 숫자를 읽지 않아도 보인다.
 */
export function NoulRow({
  label,
  value,
  threshold,
}: {
  label: string;
  value: number | null;
  threshold: number;
}) {
  if (value === null) {
    return (
      <div className="flex items-center gap-2">
        <Chip kind="Noul" />
        <span className="text-[11px] text-[var(--muted)]">{label}</span>
        <span className="ml-auto tnum text-[11px] text-[var(--muted)]">묻지 않음</span>
      </div>
    );
  }

  const passed = value >= threshold;

  return (
    <div className="land flex items-center gap-2">
      <Chip kind="Noul" />
      <span className="shrink-0 text-[11px] text-[var(--muted)]">{label}</span>

      <div
        className="relative ml-auto h-1.5 w-24 shrink-0 overflow-hidden rounded-full"
        style={{ background: "var(--wash)" }}
        aria-hidden
      >
        <div
          className={passed ? "iri h-full" : "h-full"}
          style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`,
            background: passed ? undefined : "var(--gen)",
          }}
        />
        <div
          className="absolute top-0 h-full w-px"
          style={{ left: `${threshold * 100}%`, background: "var(--ink)", opacity: 0.55 }}
          title={`문턱 ${threshold.toFixed(2)}`}
        />
      </div>

      <b className={`tnum w-9 shrink-0 text-right text-[11px] ${passed ? "iri-text" : "text-[var(--muted)]"}`}>
        {value.toFixed(2)}
      </b>
    </div>
  );
}

/**
 * 두 줄짜리 시간 막대.
 *
 * 위는 생성 모델(사진 → 글), 아래는 Jev(글 → 판정). **같은 눈금**으로 그린다.
 * 아래 줄이 왜 납작한지는 설명할 필요가 없다.
 */
export function Tracks({
  gen,
  jev,
  genMs,
  jevMs,
}: {
  gen: number[];
  jev: number[];
  /** 그 줄이 실제로 걸린 시간. 장별 시간의 합이 아니다(여러 장을 한꺼번에 읽는다). */
  genMs: number;
  jevMs: number;
}) {
  const max = Math.max(1, ...gen, ...jev);

  return (
    <div className="space-y-2">
      <TrackRow title="생성 모델 · 사진→글" values={gen} kind="gen" max={max} elapsed={genMs} />
      <TrackRow title="Jev · 글→판정" values={jev} kind="jev" max={max} elapsed={jevMs} />
    </div>
  );
}

function TrackRow({
  title,
  values,
  kind,
  max,
  elapsed,
}: {
  title: string;
  values: number[];
  kind: "gen" | "jev";
  max: number;
  elapsed: number;
}) {

  return (
    <div className="flex items-end gap-3">
      <div className="w-28 shrink-0 pb-1">
        <div
          className={`text-[11px] ${kind === "jev" ? "iri-text font-semibold" : "text-[var(--muted)]"}`}
        >
          {title}
        </div>
        <div className="tnum text-[10px] text-[var(--muted)]">
          {values.length > 0 ? `${values.length}장 · ${(elapsed / 1000).toFixed(1)}초` : "·"}
        </div>
      </div>
      <div className="flex h-8 flex-1 items-end gap-[2px]">
        {values.map((ms, i) => (
          <div
            key={i}
            className={kind === "jev" ? "iri flex-1 rounded-[1px]" : "flex-1 rounded-[1px]"}
            style={{
              height: `${Math.max(2, (ms / max) * 100)}%`,
              background: kind === "jev" ? undefined : "var(--gen)",
            }}
            title={`${Math.round(ms)}ms`}
          />
        ))}
      </div>
    </div>
  );
}

/** 머리 계측기. 「출력 무료」만 무지개빛이다 — 그게 이 모델의 성질이라서. */
export function Meter({
  judgments,
  jevMs,
  jevInput,
  genMs,
  genInput,
  genOutput,
  genModel,
  jevModel,
}: {
  judgments: number;
  jevMs: number;
  jevInput: number;
  genMs: number;
  genInput: number;
  genOutput: number;
  genModel: string;
  jevModel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg" style={{ background: "var(--line)" }}>
      <div className="p-3" style={{ background: "var(--paper)" }}>
        <div className="text-[10px] tracking-wide text-[var(--muted)]">{genModel}</div>
        <div className="tnum mt-1 text-[15px]">
          {(genMs / 1000).toFixed(1)}초
          <span className="ml-1 text-[10px] text-[var(--muted)]">걸린 시간</span>
        </div>
        <div className="tnum mt-0.5 text-[10px] text-[var(--muted)]">
          입력 {genInput.toLocaleString()} · 출력 {genOutput.toLocaleString()} tok
        </div>
      </div>

      <div className="p-3" style={{ background: "var(--paper)" }}>
        <div className="text-[10px] tracking-wide">
          <span className="iri-text font-semibold">Jev</span>
          {jevModel === "off" && <span className="text-[var(--muted)]"> · 꺼짐</span>}
        </div>
        <div className="tnum mt-1 text-[15px]">
          {(jevMs / 1000).toFixed(1)}초
          <span className="ml-1 text-[10px] text-[var(--muted)]">걸린 시간 · 판정 {judgments}</span>
        </div>
        <div className="tnum mt-0.5 text-[10px] text-[var(--muted)]">
          입력 {jevInput.toLocaleString()} tok ·{" "}
          <span className="iri-text font-semibold">출력 무료</span>
        </div>
      </div>
    </div>
  );
}
