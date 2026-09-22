/**
 * 찍힌 시각 되찾기.
 *
 * 순찰 사진은 대개 카메라가 날짜·시각을 **화면에 찍어 준다**(「2026년 5월 12일 오전 6:28」).
 * 그 글자는 앞 단계가 이미 `text_in_photo` 에 옮겨 적어 두었다. 그러니 다시 묻지 않는다 —
 * **코드가 읽는다.** 모델에게 「몇 시니」라고 묻는 것은 읽을 수 있는 것을 짐작시키는 일이다.
 *
 * 쓰는 자리 둘:
 * - EXIF 가 없을 때 일지의 시각 칸. 메신저로 주고받은 사진은 EXIF 가 벗겨져 온다.
 * - 앞 장과 몇 분 차인지. 「같은 자리인가」를 물을 때 이만큼 센 재료가 없다.
 */

export interface ShotStamp {
  /** YYYY-MM-DD. 워터마크에 날짜가 없으면 빈 문자열. */
  date: string;
  /** HH:MM, 24시간. */
  time: string;
  /** 자정부터의 분. 날짜가 다르면 이 값만으로 빼면 안 된다. */
  minutes: number;
}

/**
 * 사진에서 읽은 글자에서 촬영시각을 찾는다. 못 찾으면 null — **지어내지 않는다.**
 *
 * 받아들이는 꼴:
 *   2026년 5월 12일 오전 6:28   (국산 카메라 앱 기본)
 *   2026-05-12 18:04 · 2026.05.12 6:28
 *   2026/05/12 6:28 AM
 *   오전 6:28 · 6:28 PM         (날짜 없이 시각만)
 */
export function readStamp(text: string | null | undefined): ShotStamp | null {
  if (!text) return null;

  const date = readDate(text);
  const clock = readClock(text);
  if (!clock) return null;

  return {
    date,
    time: `${pad(clock.hour)}:${pad(clock.minute)}`,
    minutes: clock.hour * 60 + clock.minute,
  };
}

/** EXIF 로 이미 아는 "HH:MM" 을 같은 꼴로. 읽을 수 없으면 null. */
export function stampFromClock(date: string, time: string): ShotStamp | null {
  const parsed = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!parsed) return null;
  return { date, time, minutes: Number(parsed[1]) * 60 + Number(parsed[2]) };
}

/** 두 장 사이가 몇 분인가. 어느 한쪽이라도 시각을 모르면 null. */
export function minutesBetween(earlier: ShotStamp | null, later: ShotStamp | null): number | null {
  if (!earlier || !later) return null;

  // 날짜를 둘 다 알면 날짜째로 센다. 자정을 넘긴 순찰도 있다.
  if (earlier.date && later.date && earlier.date !== later.date) {
    const days = Math.round((Date.parse(later.date) - Date.parse(earlier.date)) / 86_400_000);
    if (!Number.isFinite(days)) return null;
    return days * 1440 + (later.minutes - earlier.minutes);
  }

  return later.minutes - earlier.minutes;
}

/**
 * 그 회차의 날짜. 일지 머리글에 찍히는 값이다.
 *
 * **가장 많이 나온 날짜로 정한다.** 「날짜가 있는 첫 장」으로 정하면 한 장만 잘못 읽혀도
 * 일지 전체의 날짜가 틀어진다. 같은 수면 이른 날짜로 — 순찰은 앞 날짜에서 시작한다.
 * 아무 장에서도 못 읽으면 빈 문자열(부르는 쪽이 오늘 날짜로 채운다).
 */
export function commonDate(dates: (string | null | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const date of dates) {
    if (!date) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  let best = "";
  let most = 0;
  for (const [date, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > most) {
      best = date;
      most = count;
    }
  }
  return best;
}

/**
 * 올라온 차례가 찍힌 차례와 거꾸로인 대목이 몇 군데인가.
 *
 * 묶기 규칙 전체가 「찍은 차례 = 순찰 동선」에 기대고 있다. 그 전제가 깨졌으면 **말해 줘야 한다.**
 * 차례를 몰래 바꾸지는 않는다 — 시각을 못 읽은 장이 섞여 있으면 어디에 끼울지 알 수 없고,
 * 조용히 바꾼 차례는 사람이 확인할 수 없다.
 */
export function countBackwards(stamps: (ShotStamp | null)[]): number {
  let backwards = 0;
  let last: ShotStamp | null = null;

  for (const stamp of stamps) {
    if (!stamp) continue;
    const gap = minutesBetween(last, stamp);
    if (gap !== null && gap < 0) backwards++;
    last = stamp;
  }
  return backwards;
}

function readDate(text: string): string {
  const korean = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(text);
  if (korean) return iso(korean[1], korean[2], korean[3]);

  const dotted = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(text);
  if (dotted) return iso(dotted[1], dotted[2], dotted[3]);

  return "";
}

function readClock(text: string): { hour: number; minute: number } | null {
  // 꼴을 차례로 대 본다. 앞 꼴이 걸렸는데 값이 말이 안 되면 **다음 꼴로 넘어간다** —
  // 거기서 멈추면 읽을 수 있는 시각을 버리게 된다.

  // 오전/오후는 시각 **앞**에 온다 — 국산 카메라 앱의 꼴이다.
  const korean = /(오전|오후)\s*(\d{1,2})\s*:\s*(\d{2})/.exec(text);
  const fromKorean = korean
    ? meridiem(korean[1] === "오후", Number(korean[2]), Number(korean[3]))
    : null;
  if (fromKorean) return fromKorean;

  // AM/PM 은 뒤에 온다.
  const english = /\b(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*\d{2})?\s*([AaPp])\.?[Mm]\b/.exec(text);
  const fromEnglish = english
    ? meridiem(english[3].toLowerCase() === "p", Number(english[1]), Number(english[2]))
    : null;
  if (fromEnglish) return fromEnglish;

  const plain = /\b([01]?\d|2[0-3])\s*:\s*([0-5]\d)\b/.exec(text);
  if (plain) return { hour: Number(plain[1]), minute: Number(plain[2]) };

  return null;
}

/**
 * 12시가 함정이다 — 오전 12:05 는 0시 5분, 오후 12:05 는 12시 5분이다.
 * 「오전 0:10」 처럼 0 시로 적는 앱도 있어 0 도 받는다(자정 넘긴 순찰).
 */
function meridiem(
  afternoon: boolean,
  hour: number,
  minute: number,
): { hour: number; minute: number } | null {
  if (hour < 0 || hour > 12 || minute > 59) return null;
  const base = hour === 12 ? 0 : hour;
  return { hour: afternoon ? base + 12 : base, minute };
}

function iso(year: string, month: string, day: string): string {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${year}-${pad(m)}-${pad(d)}`;
}

function pad(value: number): string {
  return `${value}`.padStart(2, "0");
}
