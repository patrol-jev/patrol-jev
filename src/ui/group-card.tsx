"use client";

/* eslint-disable @next/next/no-img-element */

import { HUMAN_CHOICES, laneLabel, type LaneOrUnknown, type Thresholds } from "@/core/lanes";
import { useState } from "react";
import { decideLane, decidingJudgment } from "@/core/group";
import type { Described, Group, Judged } from "@/core/types";
import type { PreparedPhoto } from "./photo";
import { ChoiceBar, Chip, Ms, NoulRow } from "./jev";

/**
 * 한 자리(묶음) 한 칸.
 *
 * 무지개빛은 Jev 가 낸 값에만 붙는다. 사람이 손대면 그 자리는 회색이 된다.
 * 무엇을 기계가 정했고 무엇을 사람이 정했는지 나중에 봐도 구분되게.
 */
export function GroupCard({
  group,
  order,
  photos,
  judged,
  described,
  thresholds,
  isFirst,
  onLane,
  onAddress,
  onWork,
  phrases,
  defaultWork,
  onMergeUp,
  onSplitAt,
}: {
  group: Group;
  order: number;
  photos: PreparedPhoto[];
  judged: Record<number, Judged>;
  described: Record<number, Described>;
  thresholds: Thresholds;
  isFirst: boolean;
  onLane: (lane: LaneOrUnknown) => void;
  onAddress: (address: string) => void;
  /** 이 자리에 대해 일지에 적을 말. 비우면 란의 기본 문구를 쓴다. */
  onWork: (work: string) => void;
  /** 지금까지 써 본 말들. 고를 수 있게 띄운다. */
  phrases: string[];
  /** 그 란의 기본 문구. 안 고쳤을 때 무엇이 적히는지 보여 준다. */
  defaultWork: string;
  onMergeUp: () => void;
  onSplitAt: (photoIndex: number) => void;
}) {
  const byIndex = new Map(Object.values(judged).map((j) => [j.index, j]));
  // 막대는 이 묶음의 갈래를 정한 그 한 장의 분포다. 평균이 아니라 실제로 정한 값이다.
  const deciding = decidingJudgment(group.photos, byIndex, thresholds);
  // 기계 혼자였으면 무엇으로 봤을지. 사람이 고쳐 둔 자리에서 그 값을 나란히 보인다.
  // 덮었다는 것을 숨기면 그 자리에 정말 다른 일이 생긴 날 사람이 알아채지 못한다.
  const machineLane = decideLane(group.photos, byIndex, thresholds);
  const probabilities = deciding?.laneProbabilities ?? null;
  const undecided = group.lane === "unknown";
  /** 전체보기로 띄운 사진. 없으면 null. */
  const [zoom, setZoom] = useState<string | null>(null);

  const ms = group.photos.reduce((sum, i) => sum + (judged[i]?.ms ?? 0), 0);
  const plate = group.photos.map((i) => judged[i]?.addressPlate).find((v) => v != null) ?? null;
  // 주소를 도로명 색인과 맞춰 본 결과. 고친 것도, 못 찾은 번호도 숨기지 않는다.
  const corrected = group.photos.map((i) => described[i]?.signRaw).find((v) => v) ?? null;
  const missingNumber = group.photos.some((i) => described[i]?.signExists === false);
  const sameLocation = judged[group.photos[0]]?.sameLocation ?? null;

  return (
    <article
      className={`rounded-xl p-3 ${undecided && !group.edited ? "iri-edge" : ""}`}
      style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="tnum text-[12px] text-[var(--muted)]">
          {order}
          {group.time ? ` · ${group.time}` : ""}
        </span>

        <select
          value={group.lane}
          onChange={(event) => onLane(event.target.value as LaneOrUnknown)}
          className="rounded-md px-2 py-1 text-[12px]"
          style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          {HUMAN_CHOICES.map((lane) => (
            <option key={lane} value={lane}>
              {laneLabel(lane)}
            </option>
          ))}
        </select>

        <span className="flex-1" />

        {group.learned && !group.edited && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px]"
            style={{ background: "var(--wash)", color: "var(--muted)" }}
          >
            지난번 고친 대로
            {machineLane !== "unknown" &&
              machineLane !== group.lane &&
              ` · 기계는 ${laneLabel(machineLane)}`}
          </span>
        )}

        {group.edited && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px]"
            style={{ background: "var(--wash)", color: "var(--muted)" }}
          >
            사람이 고침
          </span>
        )}

        {!isFirst && (
          <button
            onClick={onMergeUp}
            className="rounded-md px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--ink)]"
            style={{ border: "1px solid var(--line)" }}
          >
            위와 합치기
          </button>
        )}
      </header>

      {/* 주소와 문구는 각각 한 줄을 통째로 쓴다. 좁은 화면에서 칸이 좁으면 글자가 잘려 못 고친다. */}
      <div className="mt-2 space-y-1.5">
        <input
          value={group.address}
          onChange={(event) => onAddress(event.target.value)}
          placeholder="주소 (주소판이 없으면 비워 두세요)"
          className="w-full rounded-md px-2 py-1.5 text-[12px]"
          style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" }}
        />

        <input
          list="patrol-works"
          value={group.work ?? ""}
          onChange={(event) => onWork(event.target.value)}
          placeholder={`일지에 적을 말 (비우면 「${defaultWork}」)`}
          className="w-full rounded-md px-2 py-1.5 text-[12px]"
          style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" }}
        />
        <datalist id="patrol-works">
          {[defaultWork, ...phrases.filter((one) => one !== defaultWork)].map((one) => (
            <option key={one} value={one} />
          ))}
        </datalist>
      </div>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {photos.map((photo) => (
          <button key={photo.index} type="button" onClick={() => setZoom(photo.url)}>
            <img
              src={photo.url}
              alt=""
              className="h-20 w-20 shrink-0 rounded-md object-cover"
              style={{ background: "var(--wash)" }}
            />
          </button>
        ))}
      </div>

      {/* 전체보기. 섬네일로는 주소판 글자가 안 보인다. 아무 데나 누르면 닫힌다. */}
      {zoom && (
        <button
          type="button"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.85)" }}
          aria-label="닫기"
        >
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </button>
      )}

      <div className="mt-3 space-y-2">
        {probabilities ? (
          <ChoiceBar
            probabilities={probabilities}
            decided={!undecided}
            chosen={group.lane === "unknown" ? null : group.lane}
            ms={ms}
          />
        ) : (
          <div className="h-2 w-full rounded-full waiting" />
        )}

        <NoulRow label="주소판인가" value={plate} threshold={thresholds.addressPlate} />
        <NoulRow label="앞과 같은 자리" value={sameLocation} threshold={thresholds.sameLocation} />

        {corrected && (
          <p className="text-[11px] text-[var(--muted)]">
            읽은 글자 <b className="text-[var(--ink)]">{corrected}</b> 를 우리 동 도로명으로 고쳤습니다.
          </p>
        )}
        {missingNumber && (
          <p className="text-[11px] text-[var(--muted)]">
            이 도로에 없는 건물번호입니다. 주소판을 다시 보고 고쳐 주세요.
          </p>
        )}
      </div>

      {undecided && !group.edited && (
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          확률이 문턱 아래입니다. <b className="text-[var(--ink)]">사람이 정해 주세요</b>. 억지로
          정하지 않는 편이 낫다고 보아 비워 두었습니다.
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-[var(--muted)]">
          장별 판정 {group.photos.length}
        </summary>
        <div className="mt-2 space-y-3">
          {group.photos.map((index, position) => (
            <PhotoRow
              key={index}
              photo={photos.find((p) => p.index === index)}
              described={described[index]}
              judged={judged[index]}
              thresholds={thresholds}
              canSplit={position > 0}
              onSplit={() => onSplitAt(index)}
            />
          ))}
        </div>
      </details>
    </article>
  );
}

function PhotoRow({
  photo,
  described,
  judged,
  thresholds,
  canSplit,
  onSplit,
}: {
  photo?: PreparedPhoto;
  described?: Described;
  judged?: Judged;
  thresholds: Thresholds;
  canSplit: boolean;
  onSplit: () => void;
}) {
  return (
    <div className="flex gap-3 rounded-lg p-2" style={{ background: "var(--wash)" }}>
      {photo && (
        <img src={photo.url} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
      )}

      <div className="min-w-0 flex-1 space-y-1.5">
        {/* 생성 모델이 적은 것. 늘 회색이다. */}
        <div className="flex items-start gap-2">
          <span
            className="mt-px shrink-0 rounded px-1.5 text-[10px] leading-4"
            style={{ background: "var(--gen)", color: "var(--paper)" }}
          >
            사진→글
          </span>
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--muted)]">
            {described ? described.captionKo || described.caption || "적힌 것 없음" : "읽는 중…"}
          </p>
          {described && <Ms ms={described.ms} of="gen" />}
        </div>

        {described?.signText && (
          <p className="text-[11px]">
            <span className="text-[var(--muted)]">읽은 주소판: </span>
            <span className="tnum">{described.signText}</span>
          </p>
        )}

        {judged ? (
          <>
            <ChoiceBar
              probabilities={judged.laneProbabilities}
              decided={judged.lane !== "unknown"}
              chosen={judged.lane === "unknown" ? null : judged.lane}
              ms={judged.ms}
            />
            <div className="flex items-center gap-2">
              <Chip kind="Choice" />
              <span className="text-[11px] text-[var(--muted)]">청소 전/후</span>
              <span className="ml-auto tnum text-[11px]">
                {{ before: "전", after: "후", not_applicable: "해당 없음" }[judged.stage]}
              </span>
            </div>
            <NoulRow label="주소판인가" value={judged.addressPlate} threshold={thresholds.addressPlate} />
            <NoulRow
              label="앞과 같은 자리"
              value={judged.sameLocation}
              threshold={thresholds.sameLocation}
            />
          </>
        ) : (
          <div className="h-2 w-2/3 rounded-full waiting" />
        )}

        {canSplit && (
          <button
            onClick={onSplit}
            className="text-[11px] text-[var(--muted)] underline underline-offset-2 hover:text-[var(--ink)]"
          >
            여기서 나누기
          </button>
        )}
      </div>
    </div>
  );
}
