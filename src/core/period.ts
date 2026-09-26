import { laneLabel, type LaneOrUnknown } from "./lanes";
import { readReportText } from "./ilji-slots";
import { splitWork } from "./report";

/**
 * 기간 집계. 한 주 · 한 달 · 아무 기간의 일지를 **한 사람 것끼리** 모은다.
 *
 * 일지는 하루치다. 결과 보고는 기간치다. 사이에 있는 일은 세는 일뿐이라 코드가 한다.
 * 모델을 부르지 않고, 판단도 새로 하지 않는다. 일지에 적힌 자리(란 · 주소 · 말)를 그대로 센다.
 *
 *   개요      기간 · 순찰 일수 · 처리 개소(란별) · 사진 장수
 *   일자별    날마다 란별 개소
 *   항목별    결과 보고 양식의 항목표(구분 × 내용). 사진으로 아는 항목만 채우고 나머지는 빈 칸으로 **보인다.**
 *   정비요청  일지의 말에 「통보 · 신고 · 요청」이 적힌 자리. 기능부서 정비요청 세부내역의 재료다.
 *   위험      위험시설물 점검 내역 전부(날짜 · 주소 · 말)
 *   특이      일지에 사람이 적은 특이사항 · 주민소통
 *
 * 주 단위로 내고, 달을 고르면 그 달의 주들이 그대로 합쳐진다. 같은 코드가 기간만 넓게 센다.
 * 순위·등급·평가는 **일부러 없다.** 그것은 받는 쪽이 자기 기준으로 한다. 여기서는 숫자만 센다.
 *
 * 이 파일은 브라우저에서도 돈다. 저장한 하루치 기록(`DayLike`)만 받는다. 사진은 여기 없다(따로 보관).
 */

/** 하루치 기록에서 자리 하나. 일지를 만들 때 같이 남긴다. 사진은 담지 않고 있었는지만 적는다. */
export interface SavedSpot {
  address: string;
  lane: LaneOrUnknown;
  /** 그 자리에 적은 말. 안 정했으면 빈 문자열(란의 기본 말을 썼다는 뜻). */
  work: string;
  /** HH:MM. 없으면 빈 문자열. */
  time: string;
  shade?: boolean;
  /** 정비 전·후 짝인가(순찰사항만). */
  pair: boolean;
  /** 보관한 사진이 있는가. 기간 보고서의 사진 표는 이 자리 차례대로 붙는다. */
  before: boolean;
  after: boolean;
}

/** 집계가 받는 하루치. 화면의 `DayRecord` 가 이 꼴을 만족한다. */
export interface DayLike {
  /** YYYY-MM-DD */
  date: string;
  dong: string;
  photos: number;
  groups: number;
  report: string;
  /** 이 칸이 생기기 전 기록에는 없다. 그런 날은 순찰 일수에만 든다. */
  spots?: SavedSpot[];
  /** 갈래를 못 정해 일지에 안 실린 자리 수. */
  undecided?: number;
}

export interface Period {
  /** YYYY-MM-DD, 포함. */
  from: string;
  to: string;
  /** 「2026년 9월」 · 「2026. 9. 21.(월) ~ 9. 27.(일)」. */
  label: string;
  /** 제목에 쓰는 이름. 「2026년 9월 3주차」 · 「2026년 9월」. 직접 고른 기간은 label 과 같다. */
  name: string;
  kind: "week" | "month" | "custom";
}

export type CountKey = "patrol" | "seasonal" | "facility";
export const COUNT_KEYS: CountKey[] = ["patrol", "seasonal", "facility"];
export const COUNT_LABELS: Record<CountKey, string> = { patrol: "순찰사항", seasonal: "계절특수", facility: "위험시설물" };

export type Counts = Record<CountKey, number>;

export interface DayLine {
  date: string;
  counts: Counts;
  /** 그날 사진 장수(일지에 실린 것 기준이 아니라 올린 장수). */
  photos: number;
  /** 자리 정보가 없는 옛 기록. 표에 「-」 로 적는다. */
  legacy: boolean;
  /** 그날 특이사항 줄. */
  etc: string[];
}

export interface RepeatSpot {
  address: string;
  /** 나온 날짜들(오름차순). */
  dates: string[];
  lanes: LaneOrUnknown[];
}

export interface FacilityLine {
  date: string;
  address: string;
  /** 쉼표로 나눈 말. [확인, ※ 통보, → 회신…]. */
  parts: string[];
}

/**
 * 결과 보고 양식의 항목표 한 줄. 구분(교통 · 도로 …) 아래 내용이 여럿이다.
 * 실물 양식의 줄을 그대로 옮겼다. **사진으로 알 수 없는 줄은 0 이 아니라 빈 칸**으로 낸다.
 * 0 은 「없었다」이고 빈 칸은 「이 도구로는 모른다」다. 둘을 섞으면 받는 쪽이 못 가린다.
 */
export interface CategoryRow {
  group: string;
  item: string;
  /** 이 도구가 셀 수 있는 줄인가. 아니면 값이 빈 칸이다. */
  countable: boolean;
}

export const CATEGORY_ROWS: CategoryRow[] = [
  { group: "교통", item: "방치차량 정비요청", countable: false },
  { group: "교통", item: "교통시설물 정비요청", countable: false },
  { group: "교통", item: "기타(자체정비 포함)", countable: false },
  { group: "도로", item: "도로시설물 정비요청", countable: false },
  { group: "도로", item: "도로, 보도 파손 등 정비요청", countable: false },
  { group: "도로", item: "가로등, 보안등 정비요청", countable: false },
  { group: "도로", item: "기타(자체정비 포함)", countable: false },
  { group: "청소", item: "무단투기 단속 실적", countable: false },
  { group: "청소", item: "무단투기 계고장 부착", countable: false },
  { group: "청소", item: "공중화장실 정비요청", countable: false },
  { group: "청소", item: "기타(자체정비 포함)", countable: true },
  { group: "치수방재", item: "하수시설 정비요청", countable: false },
  { group: "치수방재", item: "기타(자체정비 포함)", countable: true },
  { group: "가로정비", item: "노점상, 노상적치물 정비요청", countable: false },
  { group: "가로정비", item: "대로변 현수막 정비요청(자체정비 포함)", countable: false },
  { group: "가로정비", item: "전단지 제거", countable: false },
  { group: "가로정비", item: "기타(이면도로 등 자체정비 포함)", countable: false },
  { group: "공원녹지", item: "가로수, 녹지대 정비요청", countable: false },
  { group: "공원녹지", item: "공원시설 정비요청", countable: false },
  { group: "공원녹지", item: "기타(자체정비 포함)", countable: false },
  { group: "재난위험시설물", item: "재난위험시설 정비요청", countable: true },
  { group: "재난위험시설물", item: "재난위험시설 순찰활동", countable: true },
  { group: "재난위험시설물", item: "공사현장 불편사항 정비요청", countable: false },
  { group: "재난위험시설물", item: "기타(자체정비 포함)", countable: false },
  { group: "공공시설물", item: "다중이용시설물(청사, 복지관 등)정비요청", countable: false },
  { group: "공공시설물", item: "기타(자체정비 포함)", countable: true },
  { group: "기타", item: "기타 불편사항", countable: false },
];

/** 항목표 줄 번호(`CATEGORY_ROWS` 의 index). */
const ROW = {
  cleanEtc: 10,
  floodEtc: 12,
  riskRequest: 20,
  riskPatrol: 21,
  publicEtc: 25,
} as const;

/**
 * 자리 하나가 항목표의 어느 줄인가. 갈래 넷에서 나오는 줄은 이것뿐이다. 나머지 줄은 사진이 말해 주지 않는다.
 *
 *   순찰사항(폐기물 정비)          → 청소 · 기타(자체정비 포함)
 *   계절특수(빗물받이 · 배수구)     → 치수방재 · 기타(자체정비 포함)
 *   계절특수 가운데 그늘막 점검      → 공공시설물 · 기타(자체정비 포함)
 *   위험시설물, 말에 통보·신고·요청  → 재난위험시설물 · 재난위험시설 정비요청
 *   위험시설물, 그 밖               → 재난위험시설물 · 재난위험시설 순찰활동
 */
export function categoryOf(spot: SavedSpot): number | null {
  switch (spot.lane) {
    case "waste_cleanup":
      return ROW.cleanEtc;
    case "flood_season":
      return spot.shade ? ROW.publicEtc : ROW.floodEtc;
    case "risk_facility":
      return isRequest(spot.work) ? ROW.riskRequest : ROW.riskPatrol;
    default:
      return null;
  }
}

/**
 * 일지의 말에 기능부서로 넘긴 흔적이 있는가. 「※ 통보」「스마트불편신고」「정비 요청」 같은 것.
 * 첫 마디(한 일)는 보지 않는다. 그 뒤 마디(※ 조치 · → 경과)에서만 본다. 「확인」만 있으면 아니다.
 */
export function isRequest(work: string): boolean {
  const parts = splitWork(work.trim());
  return parts.slice(1).some((part) => /통보|신고|요청|의뢰|이첩|접수/.test(part));
}

export interface CategoryLine extends CategoryRow {
  /** 정비요청 건수. 셀 수 없는 줄이면 null(빈 칸). */
  requested: number | null;
  /** 자체정비 건수. 셀 수 없는 줄이면 null(빈 칸). */
  self: number | null;
}

/** 기능부서 정비요청 세부내역 한 줄. 일지의 말에 통보·신고·요청이 적힌 자리. */
export interface RequestLine {
  no: number;
  date: string;
  /** 항목표의 구분. */
  group: string;
  address: string;
  /** 요청내역. 말의 마디들을 「 · 」로 잇는다. */
  text: string;
  lane: LaneOrUnknown;
}

/** 동 자체 정비실적 세부내역 한 줄. 일지에 실린 자리 전부(사진 표의 차례이기도 하다). */
export interface DetailLine {
  no: number;
  date: string;
  /** 하루 안에서 몇 번째 자리인가(사진 보관 차례). */
  index: number;
  address: string;
  lane: LaneOrUnknown;
  /** 정비내역. 말이 없으면 란의 기본 말. */
  work: string;
  request: boolean;
  pair: boolean;
  hasPhoto: boolean;
}

export interface PeriodSummary {
  period: Period;
  dong: string;
  /** 기간 안에 일지가 있던 날 수. */
  days: number;
  counts: Counts;
  /** 개소 합계(세 란). */
  places: number;
  /** 보관된 사진 수(전·후 각각 한 장). */
  shots: number;
  /** 올린 사진 장수 합계. */
  uploaded: number;
  undecided: number;
  lines: DayLine[];
  repeats: RepeatSpot[];
  facilities: FacilityLine[];
  /** 결과 보고 양식의 항목표. 줄 차례는 `CATEGORY_ROWS` 그대로. */
  categories: CategoryLine[];
  /** 정비요청 건수 합(항목표의 정비요청 열 합). */
  requested: number;
  /** 자체정비 건수 합. */
  self: number;
  requests: RequestLine[];
  details: DetailLine[];
  /** 사람이 일지에 적은 특이사항(날짜 붙여서). */
  etc: Array<{ date: string; text: string }>;
  community: Array<{ date: string; text: string }>;
  /** 옛 기록(자리 정보 없음)이 섞였나. 화면이 한 줄 알린다. */
  hasLegacy: boolean;
}

const KEY_OF: Partial<Record<LaneOrUnknown, CountKey>> = { waste_cleanup: "patrol", flood_season: "seasonal", risk_facility: "facility" };

export function zeroCounts(): Counts {
  return { patrol: 0, seasonal: 0, facility: 0 };
}

/** 주소는 띄어쓰기가 들쭉날쭉하다. 붙여서 견준다. */
function addressKey(address: string): string {
  return address.replace(/\s+/g, "");
}

export function summarisePeriod(all: DayLike[], period: Period): PeriodSummary {
  const days = all
    .filter((day) => day.date >= period.from && day.date <= period.to)
    .sort((a, b) => a.date.localeCompare(b.date));

  const counts = zeroCounts();
  let shots = 0;
  let uploaded = 0;
  let undecided = 0;
  let hasLegacy = false;
  const lines: DayLine[] = [];
  const byAddress = new Map<string, RepeatSpot>();
  const facilities: FacilityLine[] = [];
  const etc: Array<{ date: string; text: string }> = [];
  const community: Array<{ date: string; text: string }> = [];
  const tally = CATEGORY_ROWS.map(() => ({ requested: 0, self: 0 }));
  const requests: RequestLine[] = [];
  const details: DetailLine[] = [];

  for (const day of days) {
    const read = readReportText(day.report || "");
    const dayEtc = read.rows.etc.map((line) => line.replace(/^[○\-·\s]+/, "").trim()).filter(Boolean);
    for (const text of dayEtc) etc.push({ date: day.date, text });
    for (const text of read.rows.community.map((line) => line.replace(/^[○\-·\s]+/, "").trim()).filter(Boolean)) {
      community.push({ date: day.date, text });
    }
    uploaded += day.photos || 0;
    undecided += day.undecided ?? 0;

    const spots = day.spots;
    if (!spots) {
      hasLegacy = true;
      lines.push({ date: day.date, counts: zeroCounts(), photos: day.photos || 0, legacy: true, etc: dayEtc });
      continue;
    }

    const dayCounts = zeroCounts();
    spots.forEach((spot, index) => {
      const key = KEY_OF[spot.lane];
      if (!key) return;
      dayCounts[key] += 1;
      counts[key] += 1;
      shots += (spot.before ? 1 : 0) + (spot.after ? 1 : 0);

      const address = spot.address.trim();
      if (address) {
        const k = addressKey(address);
        const seen = byAddress.get(k) ?? { address, dates: [], lanes: [] };
        if (!seen.dates.includes(day.date)) seen.dates.push(day.date);
        if (!seen.lanes.includes(spot.lane)) seen.lanes.push(spot.lane);
        byAddress.set(k, seen);
      }
      const work = spot.work.trim();
      const parts = splitWork(work || defaultWork(spot));
      if (spot.lane === "risk_facility") {
        facilities.push({ date: day.date, address: address || "주소 미기재", parts });
      }

      const request = isRequest(work);
      const row = categoryOf(spot);
      if (row !== null) {
        if (request) tally[row].requested += 1;
        else tally[row].self += 1;
      }
      if (request) {
        requests.push({
          no: requests.length + 1,
          date: day.date,
          group: row !== null ? CATEGORY_ROWS[row].group : laneLabel(spot.lane),
          address: address || "주소 미기재",
          text: parts.join(" · "),
          lane: spot.lane,
        });
      }
      details.push({
        no: details.length + 1,
        date: day.date,
        index,
        address: address || "주소 미기재",
        lane: spot.lane,
        work: parts.join(" · "),
        request,
        pair: spot.pair,
        hasPhoto: spot.before || spot.after,
      });
    });
    lines.push({ date: day.date, counts: dayCounts, photos: day.photos || 0, legacy: false, etc: dayEtc });
  }

  const repeats = [...byAddress.values()]
    .filter((spot) => spot.dates.length >= 2)
    .sort((a, b) => b.dates.length - a.dates.length || a.address.localeCompare(b.address));

  const categories: CategoryLine[] = CATEGORY_ROWS.map((row, i) => ({
    ...row,
    requested: row.countable ? tally[i].requested : null,
    self: row.countable ? tally[i].self : null,
  }));

  return {
    period,
    dong: days.find((day) => day.dong)?.dong ?? "",
    days: days.length,
    counts,
    places: counts.patrol + counts.seasonal + counts.facility,
    shots,
    uploaded,
    undecided,
    lines,
    repeats,
    facilities,
    categories,
    requested: tally.reduce((n, t) => n + t.requested, 0),
    self: tally.reduce((n, t) => n + t.self, 0),
    requests,
    details,
    etc,
    community,
    hasLegacy,
  };
}

/** 말을 안 정한 자리의 기본 말. 일지 문장과 같은 뜻으로, 짧게. */
function defaultWork(spot: SavedSpot): string {
  if (spot.lane === "waste_cleanup") return "폐기물 처리 및 수거";
  if (spot.lane === "flood_season") return spot.shade ? "그늘막 점검" : "배수구 주변 정비";
  if (spot.lane === "risk_facility") return "현장 확인";
  return laneLabel(spot.lane);
}

/* ── 기간 고르기 ─────────────────────────────────────────────── */

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function iso(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 「9. 21.(월)」. 연도는 뺀다(기간 라벨이 이미 말한다). */
export function shortDate(date: string): string {
  const d = parse(date);
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEKDAYS[d.getDay()]})`;
}

/** 「2026. 9. 21.(월)」. */
export function longDate(date: string): string {
  const d = parse(date);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.(${WEEKDAYS[d.getDay()]})`;
}

/** 월요일 1, 일요일 7. */
export function weekdayIndex(date: string): number {
  const d = parse(date).getDay();
  return d === 0 ? 7 : d;
}

/**
 * 「9월 3주차」. 그 주 **월요일**이 든 달과, 월요일 날짜로 센 주. (1~7일 = 1주차, 8~14일 = 2주차 …)
 * 주간 제출본이 오래 써 온 셈법이라 그대로 따른다.
 */
export function weekName(monday: string): string {
  const d = parse(monday);
  return `${d.getMonth() + 1}월 ${Math.floor((d.getDate() - 1) / 7) + 1}주차`;
}

/** 그 달. `ym` = YYYY-MM. */
export function monthPeriod(ym: string): Period {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${`${last}`.padStart(2, "0")}`, label: `${y}년 ${m}월`, name: `${y}년 ${m}월`, kind: "month" };
}

/** 그 날이 든 주. 월요일부터 일요일까지. */
export function weekPeriod(date: string): Period {
  const d = parse(date);
  const back = (d.getDay() + 6) % 7;
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  const monday = iso(from);
  return {
    from: monday,
    to: iso(to),
    label: `${longDate(monday)} ~ ${shortDate(iso(to))}`,
    name: `${from.getFullYear()}년 ${weekName(monday)}`,
    kind: "week",
  };
}

/** 사람이 직접 고른 두 날짜. 거꾸로 주면 바로잡는다. */
export function customPeriod(a: string, b: string): Period {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const label = `${longDate(from)} ~ ${from.slice(0, 4) === to.slice(0, 4) ? shortDate(to) : longDate(to)}`;
  return { from, to, label, name: label, kind: "custom" };
}

export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const moved = new Date(y, m - 1 + by, 1);
  return `${moved.getFullYear()}-${`${moved.getMonth() + 1}`.padStart(2, "0")}`;
}

export function shiftWeek(date: string, by: number): string {
  const d = parse(date);
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + by * 7));
}

/* ── 글 ──────────────────────────────────────────────────────── */

const H1 = "  ○ ";
const H2 = "    - ";

/**
 * 기간 보고 글. 양식이 다른 동은 이 글을 복사해 붙인다. 일지 글과 같은 줄머리를 쓴다.
 * 숫자와 자리만 있고 평가하는 말은 없다. 항목표는 값이 있는 줄만 적는다(빈 줄은 글에서는 소음이다).
 */
export function periodText(s: PeriodSummary, dong?: string): string {
  const name = (dong || s.dong || "○○동").trim();
  const out: string[] = [];
  out.push(`${name} 현장 순찰 결과 보고 (${s.period.name})`);
  out.push("");
  out.push("□ 순찰 개요");
  out.push(` ○ 기간: ${longDate(s.period.from)} ~ ${longDate(s.period.to)} (순찰 ${s.days}일)`);
  out.push(
    ` ○ 처리 개소: ${s.places}개소 (${COUNT_KEYS.map((key) => `${COUNT_LABELS[key]} ${s.counts[key]}`).join(" · ")})` +
      (s.shots > 0 ? ` · 사진 ${s.shots}장` : ""),
  );
  out.push(` ○ 추진 실적: 총계 ${s.requested + s.self} (기능부서 정비요청 ${s.requested} · 동 자체정비 ${s.self})`);
  if (s.undecided > 0) out.push(` ○ 갈래 미정(일지 미기재): ${s.undecided}개소`);

  out.push("");
  out.push("□ 일자별 실적");
  if (s.lines.length === 0) out.push(`${H1}해당 없음`);
  for (const line of s.lines) {
    const body = line.legacy
      ? "자리 정보 없음(이전 기록)"
      : COUNT_KEYS.map((key) => `${COUNT_LABELS[key]} ${line.counts[key]}`).join(" · ");
    out.push(`${H1}${shortDate(line.date)} ${body}`);
  }

  out.push("");
  out.push("□ 항목별 실적 (사진으로 아는 항목만)");
  const filled = s.categories.filter((c) => (c.requested ?? 0) + (c.self ?? 0) > 0);
  if (filled.length === 0) out.push(`${H1}해당 없음`);
  for (const c of filled) {
    const bits = [c.requested ? `정비요청 ${c.requested}` : "", c.self ? `자체정비 ${c.self}` : ""].filter(Boolean);
    out.push(`${H1}${c.group} · ${c.item}: ${bits.join(" · ")}`);
  }

  out.push("");
  out.push("□ 위험시설물 점검 내역");
  if (s.facilities.length === 0) out.push(`${H1}해당 없음`);
  for (const f of s.facilities) {
    out.push(`${H1}${shortDate(f.date)} ${f.address} ${f.parts[0]}`);
    if (f.parts[1]) out.push(`${H2}※ ${f.parts[1]}`);
    for (const rest of f.parts.slice(2)) out.push(`${H2}→ ${rest}`);
  }

  if (s.requests.length > 0) {
    out.push("");
    out.push("□ 기능부서 정비요청 세부내역");
    for (const r of s.requests) out.push(`${H1}${r.no}. ${shortDate(r.date)} ${r.group} · ${r.address} · ${r.text}`);
  }

  if (s.community.length > 0) {
    out.push("");
    out.push("□ 주민소통");
    for (const c of s.community) out.push(`${H1}${shortDate(c.date)} ${c.text}`);
  }

  if (s.etc.length > 0) {
    out.push("");
    out.push("□ 특이사항");
    for (const e of s.etc) out.push(`${H1}${shortDate(e.date)} ${e.text}`);
  }
  return out.join("\n");
}

/** 자리 표 머리에 적을 란 이름. */
export function spotNote(lane: LaneOrUnknown): string {
  return laneLabel(lane);
}
