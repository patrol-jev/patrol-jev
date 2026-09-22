/**
 * 주소판에서 읽은 글자를 **그 동의 실제 도로명**에 맞춰 보는 자리.
 *
 * 생성 모델은 한글 주소판을 곧잘 헛읽는다. 실물 30장으로 재 보니 열 곳 중 넷이 틀렸다 —
 * 한 자나 두 자가 어긋난 이름으로 읽는다.
 * 사람이 보면 바로 아는 오독이다. 그 동에 그런 도로가 없기 때문이다.
 *
 * 그래서 **모델에게 다시 묻지 않고** 행정안전부 도로명주소 색인과 맞춰 본다.
 * 여기에는 판단이 없다. 규칙은 셋뿐이다.
 *   ① 그 동에 있는 도로명이면 그대로 둔다.
 *   ② 없으면 글자 두 자 안쪽으로 다른 도로명 **하나**가 짚이는 경우에만 고친다.
 *      둘 이상이 비슷하면 고르지 않는다 — 찍어서 고친 주소는 안 고친 것만 못하다.
 *   ③ 건물번호가 그 도로에 실제 있는지 본다. 없으면 고치지 않고 **표시만** 한다.
 *
 * 색인은 `npm run roads:build` 로 만든다(`scripts/build-road-index.mjs`).
 * 색인이 없으면 이 파일의 모든 함수는 읽은 글자를 그대로 돌려준다 — 도구는 그대로 돈다.
 */

export interface RoadIndex {
  sigungu: string;
  dong: string;
  builtAt: string;
  source: string;
  /** 도로명 → 그 도로에 있는 건물번호("94" · "30-16"). */
  buildings: Record<string, string[]>;
}

export interface AddressReading {
  /** 일지에 쓸 최종 글자. 고쳤으면 고친 값, 아니면 읽은 값. */
  text: string;
  /** 읽은 글자 그대로. 화면에서 「무엇을 고쳤나」를 보이려고 들고 다닌다. */
  raw: string;
  road: string | null;
  building: string | null;
  /** 고친 경우에만. 안 고쳤으면 null. */
  correction: { from: string; to: string; distance: number } | null;
  /**
   * 그 도로에 그 건물번호가 실제로 있는가.
   * null = 판정할 수 없었다(색인 없음 · 도로명을 못 짚음 · 번호를 못 읽음).
   */
  exists: boolean | null;
}

/** 고칠 때 허용하는 글자 차이. 이보다 멀면 다른 도로로 본다. */
const MAX_DISTANCE = 2;

/**
 * 읽은 글자 → 주소. 색인이 없으면 손대지 않는다.
 *
 * 시·도와 시·군·구 앞머리는 떼고 본다. 주소판에 그것까지 찍힌 판도 있다.
 */
export function readAddress(raw: string, index: RoadIndex | null): AddressReading {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const base: AddressReading = {
    text: cleaned,
    raw: cleaned,
    road: null,
    building: null,
    correction: null,
    exists: null,
  };
  if (cleaned.length === 0) return base;

  const parsed = splitRoadAndBuilding(cleaned);
  if (!parsed) return base;

  base.road = parsed.road;
  base.building = parsed.building;
  base.text = joinAddress(parsed.road, parsed.building);
  if (!index) return base;

  const roads = Object.keys(index.buildings);

  // ① 있는 도로명이면 그대로.
  let road = parsed.road;
  if (!Object.prototype.hasOwnProperty.call(index.buildings, road)) {
    // ② 두 자 안쪽으로 하나만 짚이면 고친다.
    const near = nearest(road, roads, (candidate) =>
      parsed.building ? index.buildings[candidate].includes(parsed.building) : false,
    );
    if (near) {
      base.correction = { from: road, to: near, distance: distanceOf(road, near) };
      road = near;
    }
  }

  base.road = road;
  base.text = joinAddress(road, parsed.building);

  // ③ 번호가 그 도로에 있는지. 고치지는 않는다.
  if (parsed.building && Object.prototype.hasOwnProperty.call(index.buildings, road)) {
    base.exists = index.buildings[road].includes(parsed.building);
  }
  return base;
}

/** 그 동에서 자주 나오는 도로명. 사진을 읽힐 때 참고 목록으로 넘긴다. */
export function commonRoads(index: RoadIndex | null, limit = 40): string[] {
  if (!index) return [];
  // 색인은 건물 수가 많은 도로부터 담겨 있다(build-road-index.mjs).
  return Object.keys(index.buildings).slice(0, limit);
}

/**
 * 「○○로1나길 14」 → { road: "○○로1나길", building: "14" }.
 *
 * 번호는 **맨 뒤의 숫자 덩어리**로 본다. 도로명 한가운데 숫자가 들어가므로(1나길·13길)
 * 앞에서부터 찾으면 길 번호를 건물번호로 잘못 읽는다.
 */
function splitRoadAndBuilding(text: string): { road: string; building: string | null } | null {
  const withoutArea = text.replace(/^(?:\S+(?:특별시|광역시|시|도)\s+)?(?:\S+(?:시|군|구)\s+)?/, "");
  const match = /^(.*?[가-힣])\s*(\d+(?:-\d+)?)\s*(?:번지|번)?$/.exec(withoutArea);

  if (!match) {
    // 번호 없이 도로명만 읽힌 판도 있다. 「로」나 「길」로 끝나면 도로명으로 본다.
    return /(?:로|길)$/.test(withoutArea) ? { road: withoutArea.replace(/\s+/g, ""), building: null } : null;
  }

  const road = match[1].replace(/\s+/g, "");
  if (!/(?:로|길)$/.test(road)) return null;
  return { road, building: match[2] };
}

function joinAddress(road: string, building: string | null): string {
  return building ? `${road} ${building}` : road;
}

/**
 * 두 자 안쪽으로 **하나만** 짚이는 도로명. 둘 이상이 같은 거리면 고르지 않는다.
 *
 * 다만 같은 거리로 여럿이 걸렸을 때, **읽은 건물번호가 실제로 있는 도로**가 그중 하나뿐이면
 * 그쪽으로 정한다. 주소판에는 도로명과 번호가 같이 찍혀 있고, 둘이 서로를 증명한다 —
 * 한 자가 틀린 이름은 비슷한 도로 둘 사이에서 갈리는 일이 잦은데,
 * 읽은 번지가 있는 쪽은 대개 하나다. 찍는 것이 아니라 대조하는 것이다.
 */
function nearest(road: string, candidates: string[], hasBuilding: (road: string) => boolean): string | null {
  let bestDistance = MAX_DISTANCE + 1;
  let tied: string[] = [];

  for (const candidate of candidates) {
    // 길이가 많이 다르면 볼 것도 없다.
    if (Math.abs(candidate.length - road.length) > MAX_DISTANCE) continue;

    const distance = distanceOf(road, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      tied = [candidate];
    } else if (distance === bestDistance) {
      tied.push(candidate);
    }
  }

  if (bestDistance > MAX_DISTANCE) return null;
  // 짧은 이름에서 두 자를 고치면 다른 도로가 된다. 이름 길이에 견주어 막는다.
  if (bestDistance > Math.max(1, Math.floor(road.length / 3))) return null;

  if (tied.length === 1) return tied[0];

  const confirmed = tied.filter(hasBuilding);
  return confirmed.length === 1 ? confirmed[0] : null;
}

/** 글자 단위 편집거리(레벤슈타인). 한글 한 음절을 한 글자로 센다. */
function distanceOf(a: string, b: string): number {
  const rows = [...a];
  const cols = [...b];
  let previous = Array.from({ length: cols.length + 1 }, (_, i) => i);

  for (let i = 1; i <= rows.length; i++) {
    const current = [i];
    for (let j = 1; j <= cols.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (rows[i - 1] === cols[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[cols.length];
}
