import type { Lane, LaneOrUnknown } from "./lanes";
import { DEFAULT_WORDING, type Wording } from "./report";
import { minutesBetween, type ShotStamp } from "./shot-time";
import type { Group } from "./types";

/**
 * 수동 모드. **모델을 한 번도 부르지 않고** 일지를 만드는 길.
 *
 * 사진을 읽는 단계를 통째로 사람에게 넘긴다. 부르는 모델이 없으니 돈이 들지 않는다.
 * 그러고도 도구가 남는다. 묶기·시각·문장·학습은 처음부터 코드였다. 사람이 채우는 것은
 * **자리와 말 둘뿐**이고, 나머지는 자동 모드와 똑같이 돈다.
 *
 * 이 모드가 필요한 자리는 셋이다.
 *   ① 맛보기 한도를 다 쓴 사람. 「내일 오세요」로 끝내면 그 사람은 안 돌아온다.
 *   ② 키가 없는 사람. 받아서 바로 돌려 볼 수 있어야 한다.
 *   ③ **사진을 밖으로 못 보내는 곳.** 내부망 규정이 있는 동에게는 이게 유일한 모드다.
 *
 * ⚠ 여기에서 사진을 읽지 않는다. 주소판 글자도, 워터마크 시각도 읽지 않는다.
 * 그건 눈이 있어야 하는 일이다. 코드가 사진에서 가져올 수 있는 것은 **EXIF 시각**뿐이고,
 * 그건 이미 `src/ui/photo.ts` 가 읽고 있다. 못 읽은 자리는 **비워 둔다**. 이 레포의 규칙이다.
 *
 * 브라우저에서도 서버에서도 돈다. 파일도 네트워크도 건드리지 않는다.
 */

/** 문구 하나에 갈래 하나. 사람이 말을 고르면 란이 따라온다. */
export interface Phrase {
  text: string;
  lane: Lane;
}

/**
 * 처음부터 있는 말 넷. 일지의 세 란과 짝이고, 계절특수만 배수구·그늘막 둘이다.
 *
 * 사람이 보고서에서 문구를 고쳤으면 고친 말이 여기 들어온다. 부서마다 쓰는 말이 달라도
 * 코드를 고칠 일이 없다는 `report.ts` 의 약속이 이 모드에서도 그대로 산다.
 */
export function defaultPhrases(wording?: Partial<Wording>): Phrase[] {
  const say: Wording = { ...DEFAULT_WORDING, ...wording };
  return [
    { text: say.patrolWork, lane: "waste_cleanup" },
    { text: say.drainWork, lane: "flood_season" },
    { text: say.shadeWork, lane: "flood_season" },
    { text: say.facilityWork, lane: "risk_facility" },
  ];
}

/** 사람이 고를 수 있는 말 전부. 기본 셋이 먼저, 그 뒤에 지금까지 써 본 말. */
export function allPhrases(wording: Partial<Wording> | undefined, learned: Phrase[]): Phrase[] {
  const base = defaultPhrases(wording);
  const seen = new Set(base.map((one) => one.text));
  const rest = learned.filter((one) => one.text.trim() && !seen.has(one.text));
  return [...base, ...rest];
}

/**
 * 이 말은 어느 란인가. 모르는 말이면 null. **짐작해서 란을 정하지 않는다.**
 * 사람이 새로 친 말은 그 자리의 갈래를 그대로 쓰고, 그때 이 표에 얹힌다.
 */
export function laneOfPhrase(text: string, phrases: Phrase[]): Lane | null {
  const said = text.trim();
  if (!said) return null;
  return phrases.find((one) => one.text.trim() === said)?.lane ?? null;
}

/** 묶기에 들어가는 한 장. 사진 자체는 안 들어온다. 차례와 시각이면 된다. */
export interface ManualPhoto {
  index: number;
  /** EXIF 에서 읽은 시각. 없으면 null. 모르는 것을 가까운 시각으로 치지 않는다. */
  stamp: ShotStamp | null;
}

export interface ManualOptions {
  /** 시각을 모를 때 몇 장씩 끊을지. 한 자리에서 전·후·주소판 석 장이 보통이다. */
  groupSize: number;
  /** 앞 장과 이 분 안이면 같은 자리. 0 이면 시각을 아예 안 쓴다. */
  sameMinutes: number;
  /** 새 자리의 기본 갈래. 기본 문구의 갈래와 같아야 한다. */
  lane: LaneOrUnknown;
}

export interface ManualGrouping {
  groups: Group[];
  /**
   * 무엇으로 묶었는지. 화면에 그대로 적는다. 이 도구는 어떤 값이 어디서 왔는지 숨기지 않는다.
   * "time" = 찍힌 시각 · "count" = 장수
   */
  by: "time" | "count";
}

/**
 * 사람이 손보기 전의 첫 묶음.
 *
 * **찍힌 시각이 있으면 시각이 이긴다.** 한 자리에서 두 장 찍는 데는 몇 분이 안 걸리고
 * 걸어서 다음 자리까지 가는 데는 걸린다. 실물 30장에서 이 규칙이 묶음을 29개에서 17개로
 * 줄였다. 장수로 끊는 것보다 정확하다.
 *
 * 시각을 아는 장이 절반이 안 되면 그때 장수로 끊는다. 반쯤 아는 시각으로 묶으면
 * 아는 자리만 맞고 모르는 자리는 아무 데나 붙는다. 그럴 바엔 규칙 하나로 가는 것이 낫다.
 */
export function manualGroups(photos: ManualPhoto[], options: ManualOptions): ManualGrouping {
  const size = Math.max(1, Math.floor(options.groupSize));
  const timed = photos.filter((photo) => photo.stamp).length;
  // 시각을 아는 장이 절반을 넘을 때만 시각으로 간다.
  const by: ManualGrouping["by"] =
    options.sameMinutes > 0 && timed * 2 > photos.length ? "time" : "count";

  const groups: Group[] = [];
  let current: ManualPhoto[] = [];

  const close = () => {
    if (current.length === 0) return;
    groups.push(makeGroup(current, options.lane));
    current = [];
  };

  for (let i = 0; i < photos.length; i++) {
    if (i > 0) {
      let startNew: boolean;
      if (by === "time") {
        const gap = minutesBetween(photos[i - 1].stamp, photos[i].stamp);
        // 시각을 모르는 자리에서는 장수 규칙으로 돌아간다. 모른다고 무조건 끊으면
        // 시각이 빠진 장마다 자리가 하나씩 늘어난다.
        startNew = gap === null ? current.length >= size : gap < 0 || gap > options.sameMinutes;
      } else {
        startNew = current.length >= size;
      }
      if (startNew) close();
    }
    current.push(photos[i]);
  }
  close();

  return { groups, by };
}

function makeGroup(photos: ManualPhoto[], lane: LaneOrUnknown): Group {
  const clocks = photos
    .map((photo) => photo.stamp?.time)
    .filter((time): time is string => Boolean(time))
    .sort();

  return {
    // 자동 모드의 `g…` 와 겹치지 않게. 한 회차에 두 모드가 섞이지는 않지만, 섞여도 안 깨지게.
    id: `m${photos[0].index}`,
    photos: photos.map((photo) => photo.index),
    // 주소는 사람이 친다. **비워 두는 것이 기본값이다**. 지어낸 주소가 없는 것보다 위험하다.
    address: "",
    lane,
    edited: false,
    time: clocks[0] ?? "",
  };
}

/**
 * 수동 모드에서 한 자리를 둘로 나눈다.
 *
 * 자동 모드는 판정을 다시 세어 갈래를 정하지만 여기엔 판정이 없다. 대신 **사람이 이미
 * 정해 둔 것을 양쪽이 물려받는다**. 갈래도 말도. 주소는 앞쪽만 가진다. 뒤쪽은 다른 자리라
 * 앞의 주소를 물려주면 틀린 주소가 하나 늘어난다.
 */
export function splitManual(group: Group, photoIndex: number, stamps: Record<number, ShotStamp | null>): Group[] {
  const cut = group.photos.indexOf(photoIndex);
  if (cut <= 0) return [group];

  const half = (photos: number[], suffix: string, address: string): Group => {
    const clocks = photos
      .map((index) => stamps[index]?.time)
      .filter((time): time is string => Boolean(time))
      .sort();
    return {
      ...group,
      id: `${group.id}${suffix}`,
      photos,
      address,
      edited: true,
      time: clocks[0] ?? "",
    };
  };

  return [
    half(group.photos.slice(0, cut), "a", group.address),
    half(group.photos.slice(cut), "b", ""),
  ];
}
