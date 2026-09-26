import { readReportText, type IljiPhoto, type IljiSlots } from "./ilji-slots";
import { laneLabel } from "./lanes";
import { longDate, weekdayIndex, weekName, type DayLike, type Period } from "./period";

/**
 * 주간 일지. 그 주(월~일)에 이 기기에 남은 하루치 기록을 날짜 차례로 모아 일지 자리(`IljiSlots`)로 되돌린다.
 *
 * 하루치 기록에는 일지 글과 자리 목록(란 · 주소 · 말)이 있고, 사진의 작은 사본은 자리 차례대로 따로 보관돼 있다.
 * 여기서는 그 둘을 다시 맞춰 일지 한 장 몫으로 만든다. 새로 판단하지 않고 글도 새로 짓지 않는다.
 *
 * 기재가 없는 날은 빼고, 있는 날만 「1/5」「2/5」 로 몇째 날인지 적는다(월요일이 1). 토·일에 돈 날은 요일로 적는다.
 * 이 파일은 브라우저에서도 돈다.
 */

export interface StoredShot {
  before: Uint8Array | null;
  after: Uint8Array | null;
}

/** 그 주에 든 하루치들, 날짜 오름차순. */
export function weekDays<T extends DayLike>(days: T[], period: Period): T[] {
  return days.filter((day) => day.date >= period.from && day.date <= period.to).sort((a, b) => a.date.localeCompare(b.date));
}

/** 띠 오른쪽 말. 「9월 3주차 · 1/5」. */
export function dayTag(period: Period, date: string): string {
  const name = weekName(period.from);
  const idx = weekdayIndex(date);
  return idx <= 5 ? `${name} · ${idx}/5` : `${name} · ${["", "월", "화", "수", "목", "금", "토", "일"][idx]}`;
}

/**
 * 하루치 기록 → 일지 자리. `stored` 는 보관된 사진 사본(자리 차례), 없으면 빈 칸으로 간다.
 * `cap` 은 실을 사진 자리 수 상한. 주간은 사진 쪽이 한 쪽뿐이라 셋이다. 사진이 있는 자리를 먼저 싣는다.
 */
export function slotsFromDay(day: DayLike, stored: StoredShot[] | null, officer: string, unit: string, cap: number | null): IljiSlots {
  const read = readReportText(day.report || "");
  const spots = day.spots ?? [];
  const counts = { patrol: 0, seasonal: 0, facility: 0 };
  const candidates: IljiPhoto[] = [];
  spots.forEach((spot, i) => {
    if (spot.lane === "waste_cleanup") counts.patrol += 1;
    else if (spot.lane === "flood_season") counts.seasonal += 1;
    else if (spot.lane === "risk_facility") counts.facility += 1;
    else return;
    const item = stored?.[i];
    candidates.push({
      caption: spot.address.trim() || "주소 미기재",
      note: laneLabel(spot.lane),
      pair: spot.pair,
      before: item?.before ?? null,
      after: item?.after ?? null,
    });
  });
  const withPhoto = candidates.filter((p) => p.before || p.after);
  const without = candidates.filter((p) => !p.before && !p.after);
  const ordered = [...withPhoto, ...without];
  const photos = cap === null ? ordered : ordered.slice(0, cap);
  const dong = day.dong.trim() || "○○동";
  return {
    dong,
    unit,
    officer,
    dateLabel: read.dateLabel || longDate(day.date),
    area: read.area || `${dong} 관내`,
    rows: read.rows,
    counts,
    photos,
  };
}
