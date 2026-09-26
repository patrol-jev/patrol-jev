"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { HUMAN_CHOICES, laneLabel, type LaneOrUnknown } from "@/core/lanes";
import type { Phrase } from "@/core/manual";
import type { Group } from "@/core/types";
import type { PreparedPhoto } from "./photo";
import { Thumb } from "./thumb";

/**
 * 수동 모드의 한 자리.
 *
 * **무지개가 하나도 없다.** 이 화면에는 Jev 가 낸 값이 없기 때문이다. 확률도, 막대도,
 * 「주소판인가」도 없다. 색이 곧 출처라는 규칙을 지키려면 없는 값의 자리를 비워 두는 수밖에 없다.
 * 덕분에 칸이 단순해진다. 사람이 채울 것은 **자리와 말 둘뿐**이다.
 *
 * 갈래는 말을 고르면 따라온다. 그래도 칸을 숨기지는 않는다. 무엇이 따라왔는지 보여야
 * 틀렸을 때 고칠 수 있다.
 */
export function ManualCard({
  group,
  order,
  photos,
  isFirst,
  phrases,
  defaultWork,
  onAddress,
  onWork,
  onLane,
  onMergeUp,
  onSplitAt,
  moving,
  onMoveStart,
  onMovePick,
  onMoveHere,
  onRemove,
}: {
  group: Group;
  order: number;
  photos: PreparedPhoto[];
  isFirst: boolean;
  /** 고를 수 있는 말과 그 란. 눌러서 넣을 수 있게 칸 밑에 깔아 둔다. */
  phrases: Phrase[];
  /** 비워 뒀을 때 일지에 적히는 말. */
  defaultWork: string;
  onAddress: (address: string) => void;
  /** 말이 바뀌었다. 그 말의 란을 아는 경우 같이 온다. */
  onWork: (work: string, lane: LaneOrUnknown | null) => void;
  onLane: (lane: LaneOrUnknown) => void;
  onMergeUp: () => void;
  onSplitAt: (photoIndex: number) => void;
  moving: { from: string; picked: number[] } | null;
  onMoveStart: () => void;
  onMovePick: (photoIndex: number) => void;
  onMoveHere: () => void;
  /** 이 자리를 목록에서 뺀다. 사진은 남되 어느 자리에도 안 들어가고, 일지에도 안 실린다. */
  onRemove: () => void;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  // 지우기는 두 번 누른다(지난 날짜 지우기와 같은 결). 창을 띄우지 않고 단추 글자가 바뀐다.
  const [arming, setArming] = useState(false);
  const work = group.work ?? "";
  const movingFromHere = moving?.from === group.id;

  return (
    <article className="rounded-xl p-3" style={{ background: "var(--paper)", border: "1px solid var(--line)" }}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="tnum text-[12px] text-[var(--muted)]">
          {order}
          {group.time ? ` · ${group.time}` : ""}
          {` · ${group.photos.length}장`}
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

        {group.edited && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px]"
            style={{ background: "var(--wash)", color: "var(--muted)" }}
          >
            사람이 적음
          </span>
        )}

        {/* 떨어진 자리끼리는 「위와 합치기」로 못 잇는다. 사진을 골라 다른 연번으로 보내는 길이 따로 있다. */}
        {moving === null && (
          <button
            onClick={onMoveStart}
            className="rounded-md px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--ink)]"
            style={{ border: "1px solid var(--line)" }}
          >
            사진 옮기기
          </button>
        )}
        {moving !== null && movingFromHere && (
          <span className="text-[11px] text-[var(--muted)]">옮길 사진을 누르세요 · {moving.picked.length}장</span>
        )}
        {moving !== null && !movingFromHere && (
          <button
            onClick={onMoveHere}
            disabled={moving.picked.length === 0}
            className="rounded-md px-2.5 py-1 text-[11px] font-medium"
            style={{ background: "var(--ink)", color: "var(--paper)", opacity: moving.picked.length === 0 ? 0.5 : 1 }}
          >
            {order}번 여기로
          </button>
        )}
        {!isFirst && moving === null && (
          <button
            onClick={onMergeUp}
            className="rounded-md px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--ink)]"
            style={{ border: "1px solid var(--line)" }}
          >
            위와 합치기
          </button>
        )}
        {moving === null && (
          <button
            type="button"
            onClick={() => {
              if (!arming) {
                setArming(true);
                return;
              }
              setArming(false);
              onRemove();
            }}
            onBlur={() => setArming(false)}
            className="rounded-md px-2 py-1 text-[11px]"
            style={arming ? { background: "var(--ink)", color: "var(--paper)" } : { border: "1px solid var(--line)", color: "var(--muted)" }}
            title="이 자리를 목록에서 뺍니다. 사진은 남지만 일지에는 안 실립니다. 연번은 하나씩 당겨집니다."
          >
            {arming ? "한 번 더 누르면 지웁니다" : "이 자리 지우기"}
          </button>
        )}
      </header>

      {/* 주소와 말은 각각 한 줄을 통째로 쓴다. 좁은 화면에서 칸이 좁으면 글자가 잘려 못 고친다. */}
      <div className="mt-2 space-y-1.5">
        <input
          list="patrol-roads"
          value={group.address}
          onChange={(event) => onAddress(event.target.value)}
          placeholder="주소 (모르면 비워 두세요)"
          className="w-full rounded-md px-2 py-1.5 text-[12px]"
          style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" }}
        />

        <input
          value={work}
          onChange={(event) => {
            const typed = event.target.value;
            const found = phrases.find((one) => one.text === typed.trim());
            onWork(typed, found ? found.lane : null);
          }}
          placeholder={`일지에 적을 말 (비우면 「${defaultWork}」)`}
          className="w-full rounded-md px-2 py-1.5 text-[12px]"
          style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" }}
        />

        {/* 자주 쓰는 말. 누르면 그 말이 들어가고 **란도 같이 바뀐다.** */}
        <div className="flex flex-wrap gap-1">
          {phrases.map((phrase) => {
            const on = work.trim() === phrase.text;
            return (
              <button
                key={phrase.text}
                type="button"
                onClick={() => onWork(on ? "" : phrase.text, on ? null : phrase.lane)}
                className="rounded-full px-2 py-0.5 text-[11px]"
                style={
                  on
                    ? { background: "var(--ink)", color: "var(--paper)" }
                    : { background: "var(--wash)", color: "var(--muted)", border: "1px solid var(--line)" }
                }
              >
                {phrase.text}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {photos.map((photo) => (
          <Thumb
            key={photo.index}
            photo={photo}
            onOpen={() => (movingFromHere ? onMovePick(photo.index) : setZoom(photo.url))}
            picked={movingFromHere ? moving!.picked.includes(photo.index) : undefined}
          />
        ))}
      </div>

      {/* 나누기. 몇 장째부터 다음 자리인지 누른다. 사진을 보고 고르는 일이라 숫자가 제일 빠르다. */}
      {group.photos.length > 1 && (
        <p className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--muted)]">
          <span>여기서 나누기</span>
          {group.photos.slice(1).map((photoIndex, position) => (
            <button
              key={photoIndex}
              type="button"
              onClick={() => onSplitAt(photoIndex)}
              className="tnum rounded px-1.5 py-0.5 hover:text-[var(--ink)]"
              style={{ border: "1px solid var(--line)" }}
            >
              {position + 2}장째
            </button>
          ))}
        </p>
      )}

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
    </article>
  );
}
