"use client";

import type { UsageRecord } from "@/core/types";
import { downloadBytes } from "@/ui/hwpx-photo";
import { runsCsv } from "@/ui/usage";

/**
 * 「도구가 한 일」 한 줄. 산출물(일지 · 주간 · 결과 보고서 · 지난 날) 카드마다 같은 자리에 같은 꼴로 붙는다.
 *
 * 모델이 한 것(물은 횟수) · 코드가 한 것(지난번 고친 대로 둔 자리) · 사람이 한 것(모르겠음을 정함 · 고침)을 가른다.
 * 회차가 쌓이며 호출과 고침이 내려가고 기억이 오르면 사람의 판단이 규칙으로 남고 있는 것이다.
 * 전부 코드가 센 숫자라 회색이다. 무지개는 Jev 값에만 쓴다.
 */
export interface Work {
  calls: number;
  learned: number;
  unknown: number;
  edits: number;
}

/** 회차 CSV 를 파일로. 앞에 BOM 을 둔다. 엑셀이 그게 없으면 한글을 깨뜨린다. 폰에서는 공유 창이 열린다. */
export function downloadRunsCsv(runs: UsageRecord[], stem = "순찰일지 사용 기록"): void {
  const text = "﻿" + runsCsv(runs);
  const day = new Date().toISOString().slice(0, 10);
  downloadBytes(new TextEncoder().encode(text), `${stem} ${day}.csv`, "text/csv;charset=utf-8");
}

export function WorkLine({ work, runs, head = "도구가 한 일" }: { work: Work; runs?: UsageRecord[]; head?: string }) {
  return (
    <p className="tnum text-[11.5px] text-[var(--muted)]">
      {head}
      {runs && runs.length > 0 && <> · 회차 {runs.length}</>}
      {" · "}모델에 물음 {work.calls} · 지난번 고친 대로 {work.learned} · 모르겠음 {work.unknown} · 고친 횟수 {work.edits}
      {runs && runs.length > 0 && (
        <>
          {" · "}
          <button type="button" onClick={() => downloadRunsCsv(runs)} className="underline underline-offset-2">
            CSV 받기
          </button>
        </>
      )}
    </p>
  );
}
