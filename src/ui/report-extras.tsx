"use client";

import type { IljiSlots } from "@/core/ilji-slots";
import { fillFormWeek } from "@/core/hwpx/fill";
import { fillPeriodForm } from "@/core/hwpx/fill-period";
import type { PeriodPhoto } from "@/core/hwpx/period";
import type { PeriodSummary } from "@/core/period";
import { FormBridge, keptForm, keptPeriodForm } from "@/ui/form-bridge";

/**
 * 보고서 탭 아래 붙는 자리. 부서 양식 채우기(`form-bridge.tsx`)가 여기 붙는다.
 */
export function ReportExtras(props: {
  collect: (ratio: number) => Promise<IljiSlots>;
  date: string;
  /** 부서 양식 파일을 내려받았거나 양식을 올리고 지웠을 때. 화면이 다시 읽게. */
  onFilled?: () => void;
}) {
  return <FormBridge {...props} />;
}

/**
 * 결과 보고서를 **부서 양식**으로. 결과 보고서 양식을 올려 둔 브라우저에서만 값이 있고, 아니면 null(기본 양식으로 간다).
 * 사진 비율은 그 양식의 자리 표 사진 칸 비율이다.
 */
export function periodFormOf(): { name: string; photoRatio: number; build: (input: { dong: string; officer?: string; summary: PeriodSummary; photos: PeriodPhoto[] }) => { bytes: Uint8Array; note: string } } | null {
  const kept = keptPeriodForm();
  if (!kept) return null;
  return {
    name: kept.name,
    photoRatio: kept.map.photoRatio || 1.16,
    build: (input) => {
      const result = fillPeriodForm(kept.bytes, kept.map, input);
      const notes = [`사진 ${result.photosPlaced}장을 넣었습니다.`];
      if (result.requestsDropped > 0) notes.push(`정비요청 세부내역 ${result.requestsDropped}건은 표 줄이 모자라 못 실었습니다.`);
      if (result.skipped.length > 0) notes.push(`못 채운 것: ${result.skipped.join(", ")}.`);
      return { bytes: result.bytes, note: notes.join(" ") };
    },
  };
}

/**
 * 주간 일지를 **부서 양식**으로. 양식을 올려 둔 브라우저에서만 값이 있고, 아니면 null(기본 양식으로 간다).
 * 사진 비율은 그 양식의 사진 칸 비율이다. 주간 일지 화면이 사진을 그 비율로 자르려고 먼저 묻는다.
 */
export function weeklyFormOf(): { name: string; photoRatio: number; build: (days: IljiSlots[]) => { bytes: Uint8Array; note: string } } | null {
  const kept = keptForm();
  if (!kept) return null;
  return {
    name: kept.name,
    photoRatio: kept.map.photoRatio || 1.25,
    build: (days) => {
      const result = fillFormWeek(kept.bytes, kept.map, days);
      const notes = [`사진 ${result.photosPlaced}장을 넣었습니다.`];
      if (result.skipped.length > 0) notes.push(`못 채운 란 ${result.skipped.length}개는 글에서 복사해 붙여 주세요.`);
      return { bytes: result.bytes, note: notes.join(" ") };
    },
  };
}
