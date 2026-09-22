import { REAL_LANES, type Lane, type Thresholds } from "./lanes";
import { minutesBetween, type ShotStamp } from "./shot-time";
import type { Described, Group, Judged } from "./types";

/**
 * 묶기(청킹)는 **코드가 한다**. 판정을 재료로 쓰되, 규칙은 사람이 읽을 수 있게 여기 적혀 있다.
 *
 * 자리를 끊는 자리는 셋뿐이고, 센 것부터 이 차례다.
 *
 *   ① **시각** — 앞 장과 `splitMinutes` 넘게 벌어졌으면 무엇보다 먼저 끊는다.
 *      걸어서 다음 자리까지 가는 데 걸리는 시간이 자리를 나눈다.
 *   ② **주소판** — 주소판이 자리의 경계다. 그 사람이 주소판을 자리 앞에 찍는지 뒤에 찍는지는
 *      그날 사진이 알려 준다(`wherePlate`).
 *   ③ **같은자리 확률** — 주소판이 하나도 없는 덩이에서만 쓴다. 애매하면 나눈다.
 *
 * 브라우저에서도 돈다. 사람이 고칠 때마다 서버에 다시 묻지 않으려고.
 */
export function buildGroups(
  described: Described[],
  judged: Judged[],
  thresholds: Thresholds,
  /** 장마다 찍힌 시각. 모르는 장은 null — 모르는 것을 가까운 시각으로 치지 않는다. */
  stamps: Record<number, ShotStamp | null>,
  /** 판정도 시각도 없을 때 몇 장씩 끊을지. 마지막 수단이다. */
  groupSize = 3,
): Group[] {
  const byIndex = new Map(judged.map((j) => [j.index, j]));
  const signByIndex = new Map(described.map((d) => [d.index, d.signText]));
  const order = [...described].sort((a, b) => a.index - b.index);
  const indices = order.map((one) => one.index);
  const plateAt = indices.map((index) =>
    isPlate(byIndex.get(index), signByIndex.get(index), thresholds),
  );
  const plates = new Set(indices.filter((_, i) => plateAt[i]));

  const role = wherePlate(plateAt);
  const byPlate = plateCuts(plateAt, role);

  // ① 시각이 크게 벌어진 자리. 주소판보다 세다 — 같은 주소판 앞이어도 두 시간 벌어졌으면
  //    거기서 한 일이 아니다.
  const byTime = indices.map((index, i) => {
    if (i === 0) return false;
    const gap = minutesBetween(stamps[indices[i - 1]], stamps[index]);
    if (gap === null) return false;
    return gap < 0 || gap > splitMinutesOf(thresholds);
  });

  // 큰 덩이 — 시각과 주소판이 정한 자리.
  const segments: number[][] = [];
  for (let i = 0; i < indices.length; i++) {
    if (i === 0 || byTime[i] || byPlate[i]) segments.push([]);
    segments[segments.length - 1].push(i);
  }

  // 그날의 리듬 — 자리 하나가 보통 몇 장인가. 이 값이 「너무 긴 자리」의 잣대가 된다.
  const rhythm = rhythmOf(segments, plateAt, Math.max(1, groupSize));

  const groups: Group[] = [];
  for (const segment of segments) {
    const pieces = splitSegment(segment, {
      plateAt,
      indices,
      byIndex,
      stamps,
      thresholds,
      groupSize,
      role,
      rhythm,
    });
    for (const piece of pieces) {
      groups.push(
        finish(
          piece.map((i) => indices[i]),
          plates,
          signByIndex,
          byIndex,
          thresholds,
          stamps,
        ),
      );
    }
  }

  return groups;
}

/**
 * 주소판이 자리의 **앞**인가 **뒤**인가.
 *
 * 사람마다 버릇이 다르다. 자리에 닿자마자 주소판을 찍고 일을 하는 사람이 있고,
 * 일을 끝내고 그 자리를 증명하려고 주소판을 찍는 사람이 있다. 한쪽으로 못 박아 두면
 * 다른 버릇을 가진 사람에게는 **자리가 통째로 한 장씩 밀린다** — 애써 읽은 주소가
 * 옆자리 것이 되는 것이라, 그냥 묶음이 틀리는 것보다 나쁘다.
 *
 * 그래서 그날 사진에게 묻되, **양 끝 한 장만 보지 않는다.** 첫 주소판 앞에 몇 장이 있고
 * 마지막 주소판 뒤에 몇 장이 있는지를 견준다. 앞에 찍는 사람은 주소판으로 시작해 작업사진으로
 * 끝나니 앞이 짧고 뒤가 길다. 뒤에 찍는 사람은 그 반대다.
 *
 * 끝 한 장만 보면 청소와 상관없는 사진 한 장이 앞뒤에 섞이는 것만으로 읽기가 뒤집힌다.
 * 몇 장인지로 보면 그런 것 한둘에는 안 흔들린다. 똑같으면 흔한 버릇(뒤)으로 둔다.
 */
export function wherePlate(plateAt: boolean[]): "leading" | "trailing" {
  const first = plateAt.indexOf(true);
  if (first < 0) return "trailing";
  const last = plateAt.lastIndexOf(true);

  const head = first;
  const tail = plateAt.length - 1 - last;
  return head < tail ? "leading" : "trailing";
}

/**
 * 그날의 리듬 — 주소판이 든 자리가 보통 몇 장인가.
 *
 * 한 사람이 하루를 도는 방식은 자리마다 크게 안 바뀐다. 전·후 두 장에 주소판 한 장이면
 * 내내 석 장이고, 전·후를 두 장씩 찍는 사람이면 내내 다섯 장이다. 그래서 **그날 사진이
 * 스스로 잣대를 준다.** 설정에 적어 둔 숫자보다 이쪽이 낫다 — 동마다 사람마다 다르기 때문이다.
 *
 * **과반이 같은 길이일 때만** 리듬으로 친다. 길이가 들쭉날쭉하면 잣대로 삼을 것이 없다.
 * 그때는 설정값으로 끊되 **문턱을 두 자리 몫으로 높인다** — 리듬을 모르면서 바짝 자르면
 * 멀쩡한 자리를 쪼갠다. 잴 수 있을 때만 바짝 잰다.
 */
function rhythmOf(
  segments: number[][],
  plateAt: boolean[],
  groupSize: number,
): { size: number; limit: number } {
  const loose = { size: groupSize, limit: groupSize * 2 - 1 };
  const sizes = segments.filter((one) => one.some((i) => plateAt[i])).map((one) => one.length);
  if (sizes.length < 2) return loose;

  const times = new Map<number, number>();
  for (const size of sizes) times.set(size, (times.get(size) ?? 0) + 1);

  let best = 0;
  let most = 0;
  for (const [size, count] of times) {
    if (count > most || (count === most && size < best)) {
      best = size;
      most = count;
    }
  }

  // 과반이 같은 길이다 — 그것이 그날의 리듬이고, 잣대도 그 길이다.
  return most * 2 > sizes.length ? { size: best, limit: best } : loose;
}

/** 주소판이 정하는 경계. 앞에 찍는 사람이면 주소판 **앞에서**, 뒤에 찍는 사람이면 주소판 **뒤에서** 끊는다. */
function plateCuts(plateAt: boolean[], role: "leading" | "trailing"): boolean[] {
  return plateAt.map((nowPlate, i) => {
    if (i === 0) return false;
    return role === "leading" ? nowPlate : plateAt[i - 1];
  });
}

/**
 * 주소판이 **안 들어 있는** 덩이만 더 쪼갠다.
 *
 * 주소판이 있으면 그 덩이가 곧 한 자리다. 같은자리 확률로 더 쪼개지 않는다 —
 * 그 확률은 캡션만 보고 내는 값이라, 치우기 전과 치운 뒤가 서로 달라 보이면 같은 자리인데도
 * 낮게 나온다(실물 18장 실측 중앙값 0.20). 그 값으로 주소판이 정해 준 자리를 쪼개면
 * 자리가 한 장씩 밀리고, 애써 읽은 주소가 옆자리 것이 된다.
 *
 * 주소판이 없는 덩이에서는 기댈 것이 확률과 시각뿐이다. 그때는 **애매하면 나눈다** —
 * 나눠 둔 둘을 사람이 합치는 것은 한 번이면 되지만, 잘못 합친 하나를 나누는 것은 번거롭다.
 *
 * 한 가지 안전망. 주소판이 든 덩이가 **그날의 리듬보다 길면** 그 자리에 남의 것이 섞인 것이다 —
 * 주소판 한 장을 놓쳤거나(흐리게 찍힘), 청소와 상관없는 사진이 끼어들었거나.
 * 그대로 두면 **딴 사진이 남의 주소를 물려받는다.** 그때는 주소판 쪽에서부터 리듬만큼 끊고
 * 남는 것은 주소 없는 자리로 떼어낸다 — 확률로 끊으면 중앙값 0.20 이라 낱장으로 흩어진다.
 */
function splitSegment(
  segment: number[],
  ctx: {
    plateAt: boolean[];
    indices: number[];
    byIndex: Map<number, Judged>;
    stamps: Record<number, ShotStamp | null>;
    thresholds: Thresholds;
    groupSize: number;
    role: "leading" | "trailing";
    rhythm: { size: number; limit: number };
  },
): number[][] {
  if (segment.some((i) => ctx.plateAt[i])) {
    if (segment.length <= ctx.rhythm.limit) return [segment];
    const size = Math.max(1, ctx.rhythm.size);

    // 주소판이 있는 쪽부터 끊는다. 주소판이 든 조각만 주소를 갖고, 나머지는 빈칸으로 남는다.
    const chunks: number[][] = [];
    if (ctx.role === "leading") {
      for (let at = 0; at < segment.length; at += size) chunks.push(segment.slice(at, at + size));
    } else {
      for (let end = segment.length; end > 0; end -= size) {
        chunks.unshift(segment.slice(Math.max(0, end - size), end));
      }
    }
    return chunks;
  }

  const pieces: number[][] = [];
  let current: number[] = [];

  for (const [at, i] of segment.entries()) {
    if (at > 0) {
      const index = ctx.indices[i];
      const gap = minutesBetween(ctx.stamps[ctx.indices[i - 1]], ctx.stamps[index]);
      const closeInTime =
        ctx.thresholds.sameMinutes > 0 &&
        gap !== null &&
        gap >= 0 &&
        gap <= ctx.thresholds.sameMinutes;
      const same = ctx.byIndex.get(index)?.sameLocation ?? null;

      let startNew: boolean;
      if (closeInTime) startNew = false;
      else if (same !== null) startNew = same < ctx.thresholds.sameLocation;
      // 판정이 아예 없다(키 없이 도는 경우). 그때는 장수로 끊는다 — 마지막 수단이다.
      else startNew = current.length >= Math.max(1, ctx.groupSize);

      if (startNew) {
        pieces.push(current);
        current = [];
      }
    }
    current.push(i);
  }
  if (current.length > 0) pieces.push(current);

  return pieces;
}

/**
 * 이 장이 주소판인가.
 *
 * 두 갈래 증거를 **둘 다** 센다. Jev 가 낸 「주소판일 확률」과, 사진을 읽은 모델이 실제로
 * **주소판 글자를 적어 왔는가**. 뒤엣것이 더 곧다 — 모델은 간판·현수막·전화번호·차량번호를
 * 주소판으로 적지 말라고 못 박혀 있어서, 글자가 적혀 왔다면 주소판이 프레임에 있었다는 뜻이다.
 *
 * 확률 하나만 보면 한 장을 놓치는 날이 있고, 그 한 장 때문에 두 자리가 한 자리로 붙는다.
 */
function isPlate(
  judgment: Judged | undefined,
  signText: string | null | undefined,
  thresholds: Thresholds,
): boolean {
  if ((signText ?? "").trim().length > 0) return true;
  return (judgment?.addressPlate ?? 0) >= thresholds.addressPlate;
}

/** 이 분 넘게 벌어지면 다른 자리. 옛 설정에 이 값이 없으면 5분으로 본다. */
function splitMinutesOf(thresholds: Thresholds): number {
  const value = thresholds.splitMinutes;
  return typeof value === "number" && value > 0 ? value : 5;
}

function finish(
  photos: number[],
  plates: Set<number>,
  signByIndex: Map<number, string | null>,
  byIndex: Map<number, Judged>,
  thresholds: Thresholds,
  stamps: Record<number, ShotStamp | null>,
): Group {
  // 주소는 주소판에서만 온다. 없으면 빈 칸으로 둔다 — 지어낸 주소가 없는 것보다 위험하다.
  let address = "";
  for (const index of photos) {
    if (plates.has(index)) {
      // 읽은 글자에 줄바꿈이 섞여 온다(주소판은 도로명과 번호가 두 줄이다).
      // 그대로 두면 일지 문장 한가운데서 줄이 끊긴다. 한 칸 띄어쓰기로 편다.
      address = (signByIndex.get(index) ?? "").replace(/\s+/g, " ").trim();
      if (address) break;
    }
  }

  const clocks = photos
    .map((i) => stamps[i]?.time)
    .filter((time): time is string => Boolean(time))
    .sort();

  return {
    id: `g${photos[0]}`,
    photos,
    address,
    lane: decideLane(photos, byIndex, thresholds, plates),
    edited: false,
    time: clocks[0] ?? "",
  };
}

/**
 * 묶음의 갈래 = **가장 센 한 장**이 정한다. 평균이 아니다.
 *
 * 한 자리에서 찍는 석 장은 같은 것을 세 번 찍은 것이 아니라 **역할이 다르다** —
 * 치우기 전, 치운 뒤, 그리고 주소판. 치운 뒤 사진이 「아무것도 아님」으로 나오는 것은
 * 맞는 답이지 반증이 아니다. 그런데 평균을 내면 0.98 짜리 한 장이 0.49 로 깎여
 * 문턱 아래로 내려간다. 실물 30장(자리 10곳)에서 그래서 9곳이 「모르겠음」이 됐다.
 * 가장 센 장으로 바꾸니 틀린 것 없이 5곳이 제자리를 찾았다.
 *
 * 대신 문턱은 높게 둔다(기본 0.8). 한 장만 보고 정하는 것이니 그 한 장은 분명해야 한다.
 */
export function decideLane(
  photos: number[],
  byIndex: Map<number, Judged>,
  thresholds: Thresholds,
  /** 주소판인 장들. 안 주면 확률만 보고 가린다. */
  plates?: Set<number>,
): Group["lane"] {
  const deciding = decidingJudgment(photos, byIndex, thresholds, plates);
  if (!deciding) return "unknown";

  let best: Lane = REAL_LANES[0];
  for (const lane of REAL_LANES) {
    if (deciding.laneProbabilities[lane] > deciding.laneProbabilities[best]) best = lane;
  }

  // 그 한 장조차 분명하지 않으면 비워 두고 사람에게 넘긴다.
  return deciding.laneProbabilities[best] < thresholds.lane ? "unknown" : best;
}

/**
 * 묶음의 갈래를 정한 그 한 장. 화면의 막대가 이 장의 분포를 그린다 —
 * 무엇이 이 묶음을 정했는지 사람이 볼 수 있어야 한다.
 *
 * **주소판 사진은 세지 않는다.** 주소판은 「여기가 어디인가」의 증거이지 「무슨 일인가」의
 * 증거가 아니다. 묶음이 주소판뿐이면 뺄 것이 없으니 그대로 센다. 그건 정말 「모르겠음」이 맞다.
 */
export function decidingJudgment(
  photos: number[],
  byIndex: Map<number, Judged>,
  thresholds: Thresholds,
  plates?: Set<number>,
): Judged | null {
  const voters = photos.filter((index) =>
    plates ? !plates.has(index) : !isPlate(byIndex.get(index), undefined, thresholds),
  );
  const looking = voters.length > 0 ? voters : photos;

  let deciding: Judged | null = null;
  let strongest = -1;

  for (const index of looking) {
    const judgment = byIndex.get(index);
    if (!judgment) continue;
    for (const lane of REAL_LANES) {
      const probability = judgment.laneProbabilities[lane] ?? 0;
      if (probability > strongest) {
        strongest = probability;
        deciding = judgment;
      }
    }
  }

  // 실질 갈래가 전부 0 이어도 한 장은 돌려준다. 화면에 그릴 분포가 있어야 한다.
  return deciding ?? byIndex.get(looking[0]) ?? null;
}
