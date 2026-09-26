import { REAL_LANES, type Lane, type Thresholds } from "./lanes";
import { minutesBetween, type ShotStamp } from "./shot-time";
import type { Described, Group, Judged } from "./types";

/**
 * 묶기(청킹)는 **코드가 한다**. 판정을 재료로 쓰되, 규칙은 사람이 읽을 수 있게 여기 적혀 있다.
 *
 * 자리를 끊는 자리는 셋뿐이고, 센 것부터 이 차례다.
 *
 *   ① **시각**: 앞 장과 `splitMinutes` 넘게 벌어졌으면 무엇보다 먼저 끊는다.
 *      걸어서 다음 자리까지 가는 데 걸리는 시간이 자리를 나눈다. 시각을 아는 장과 모르는 장
 *      사이도 끊는다. 모르는 것을 가까운 시각으로 치지 않는다.
 *   ② **주소판**: 주소판이 자리의 경계다. 그 사람이 주소판을 자리 앞에 찍는지 뒤에 찍는지는
 *      그날 사진이 알려 준다(`wherePlate`). Jev 가 전·후 작업 사진이라고 분명히 본 장은
 *      글자가 읽혔어도 주소판으로 치지 않는다(`isWorkShot`).
 *   ②-2 **갈래**: 이어 오던 자리의 갈래와 이 장의 갈래가 **둘 다 문턱 위로** 다르면 끊는다.
 *      주소판과 같은 급이고 시각보다는 약하다. 그늘막(계절특수)은 지나가며 한 장씩 찍는데,
 *      직전 청소 자리와 2분 안이면 ③ 의 시각 잇기가 그 자리에 붙여 버렸다(`laneCuts`).
 *   ③ **같은자리 확률**: 주소판이 하나도 없는 덩이에서만 쓴다. 애매하면 나눈다.
 *
 * 브라우저에서도 돈다. 사람이 고칠 때마다 서버에 다시 묻지 않으려고.
 */
export function buildGroups(
  described: Described[],
  judged: Judged[],
  thresholds: Thresholds,
  /** 장마다 찍힌 시각. 모르는 장은 null. 모르는 것을 가까운 시각으로 치지 않는다. */
  stamps: Record<number, ShotStamp | null>,
  /** 판정도 시각도 없을 때 몇 장씩 끊을지. 마지막 수단이다. */
  groupSize = 3,
): Group[] {
  // 시각을 아는 장과 모르는 장은 **따로** 묶는다. 모르는 장이 줄 끝에 붙어 있으면 주소판이 앞인지
  // 뒤인지 읽는 셈(`wherePlate`)이 그쪽으로 기울어 뒤집히고, 그러면 자리가 통째로 한 장씩 밀린다.
  // 실물 30장 + 자료 사진 9장에서 그랬다. 두 무리는 어차피 시각 규칙 ①이 갈라 놓는다.
  const timed = described.filter((d) => stamps[d.index]);
  if (timed.length > 0 && timed.length < described.length) {
    const untimed = described.filter((d) => !stamps[d.index]);
    return [
      ...buildGroups(timed, judged, thresholds, stamps, groupSize),
      ...buildGroups(untimed, judged, thresholds, stamps, groupSize),
    ];
  }

  const byIndex = new Map(judged.map((j) => [j.index, j]));
  const signByIndex = new Map(described.map((d) => [d.index, d.signText]));
  const order = lineUp(described, stamps);
  const indices = order.map((one) => one.index);
  const plateAt = indices.map((index) =>
    isPlate(byIndex.get(index), signByIndex.get(index), thresholds),
  );
  demoteTwinPlates(plateAt, indices, byIndex, stamps, thresholds);
  const plates = new Set(indices.filter((_, i) => plateAt[i]));

  const role = wherePlate(plateAt, indices.map((index) => stamps[index] ?? null));
  const byPlate = plateCuts(plateAt, role);

  // ① 시각이 크게 벌어진 자리. 주소판보다 세다. 같은 주소판 앞이어도 두 시간 벌어졌으면
  //    거기서 한 일이 아니다.
  const byTime = indices.map((index, i) => {
    if (i === 0) return false;
    const before = stamps[indices[i - 1]];
    const now = stamps[index];
    const gap = minutesBetween(before, now);
    // 한쪽만 시각을 알면 같은 자리로 잇지 않는다. 둘 다 모르면 시각으로는 아무 말도 못 한다.
    if (gap === null) return Boolean(before) !== Boolean(now);
    return gap < 0 || gap > splitMinutesOf(thresholds);
  });

  // ② 보탬: 뒤에 찍는 사람이라도 주소판 **바로 다음**의 분명한 「후」 사진은 그 자리의 것이다(전 → 주소판 → 후 로 찍는 자리).
  //    09-26 실물(66장): 그런 자리 셋이 주소판 뒤에서 잘려 「후」 한 장이 낱장이 되거나 다음 자리에 붙었다.
  //    같은 분 안(sameMinutes)이고, 그 자리에 아직 분명한 「후」가 없을 때만. 「전」이 오면 종전대로 새 자리다.
  if (role === "trailing") keepAfterShotWithPlate(byPlate, byTime, indices, byIndex, stamps, thresholds);

  // ②-2 갈래가 갈리는 자리. 주소판이 없어도 청소 자리에 점검 사진이 붙지 않게.
  const byLane = laneCuts(indices, plateAt, byIndex, thresholds, (i) => byTime[i] || byPlate[i]);

  // 큰 덩이. 시각과 주소판과 갈래가 정한 자리.
  const segments: number[][] = [];
  for (let i = 0; i < indices.length; i++) {
    if (i === 0 || byTime[i] || byPlate[i] || byLane[i]) segments.push([]);
    segments[segments.length - 1].push(i);
  }

  // 그날의 리듬. 자리 하나가 보통 몇 장인가. 이 값이 「너무 긴 자리」의 잣대가 된다.
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
          described,
        ),
      );
    }
  }

  return groups;
}

/**
 * 무슨 차례로 볼 것인가. **시각을 아는 장은 시각순**, 시각을 모르는 장은 그 뒤에 올라온 차례(index)로.
 *
 * 폰 사진첩은 최신이 앞이라 올라온 차례가 찍은 차례와 거꾸로일 때가 많다. 그대로 두면
 * 앞 장과의 간격이 전부 음수라 장마다 끊기고, 자리는 낱장으로 흩어진다(실물 30장에서 그랬다).
 * 사진을 열 때 EXIF 로 이미 줄 세웠으면 여기서는 같은 차례가 다시 나온다. 사진 속 글자에서
 * 시각을 되찾은 장이 있으면 그때 비로소 여기서 줄이 선다.
 *
 * 시각을 모르는 장은 **아는 장 사이에 꽂지 않는다.** 어디에 꽂아도 짐작이고, 틀리면 자리가 한 장씩
 * 밀린다. 대신 맨 뒤에 올라온 차례로 둔다. 그 장들은 묶기에서도 아는 장과 안 섞인다(`buildGroups` ①).
 * 실물 순찰 사진에 EXIF 없는 자료 사진(파일로 받은 것)이 섞인 날, 예전 규칙(한 장이라도 모르면
 * 전부 올라온 차례)은 시각 규칙을 통째로 꺼서 39장이 31자리로 흩어졌다. 화면(app.tsx)도 이 함수로 줄을 선다.
 */
export function lineUp<T extends { index: number }>(
  items: T[],
  stamps: Record<number, ShotStamp | null>,
): T[] {
  const all = [...items].sort((a, b) => a.index - b.index);
  const untimed = all.filter((one) => !stamps[one.index]);
  const byIndex = all.filter((one) => stamps[one.index]);
  if (byIndex.length < 2) return all;

  // 시각은 분까지라 같은 분에 찍힌 장이 흔하다. 그 안의 차례는 올라온 차례가 정하되,
  // 올라온 차례가 전체로 거꾸로였으면 같은 분 안에서도 거꾸로로 본다.
  let forward = 0;
  let backward = 0;
  for (let i = 1; i < byIndex.length; i++) {
    const apart = minutesBetween(stamps[byIndex[i - 1].index], stamps[byIndex[i].index]);
    if (apart === null || apart === 0) continue;
    if (apart > 0) forward += 1;
    else backward += 1;
  }
  const tie = backward > forward ? -1 : 1;

  const timed = byIndex.sort((a, b) => {
    const apart = minutesBetween(stamps[a.index], stamps[b.index]);
    if (apart === null || apart === 0) return (a.index - b.index) * tie;
    return apart > 0 ? -1 : 1;
  });
  return [...timed, ...untimed];
}

/**
 * 주소판이 자리의 **앞**인가 **뒤**인가.
 *
 * 사람마다 버릇이 다르다. 자리에 닿자마자 주소판을 찍고 일을 하는 사람이 있고,
 * 일을 끝내고 그 자리를 증명하려고 주소판을 찍는 사람이 있다. 한쪽으로 못 박아 두면
 * 다른 버릇을 가진 사람에게는 **자리가 통째로 한 장씩 밀린다**. 애써 읽은 주소가
 * 옆자리 것이 되는 것이라, 그냥 묶음이 틀리는 것보다 나쁘다.
 *
 * 그래서 그날 사진에게 묻되, **양 끝 한 장만 보지 않는다.** 첫 주소판 앞에 몇 장이 있고
 * 마지막 주소판 뒤에 몇 장이 있는지를 견준다. 앞에 찍는 사람은 주소판으로 시작해 작업사진으로
 * 끝나니 앞이 짧고 뒤가 길다. 뒤에 찍는 사람은 그 반대다.
 *
 * 끝 한 장만 보면 청소와 상관없는 사진 한 장이 앞뒤에 섞이는 것만으로 읽기가 뒤집힌다.
 * 몇 장인지로 보면 그런 것 한둘에는 안 흔들린다.
 *
 * 앞뒤가 똑같으면 **첫 장이 주소판인지**를 본다. 양 끝이 다 주소판인 경우가 그렇다.
 * 사진이 자리 경계에서 딱 잘리면(맛보기가 앞 열 장만 읽을 때처럼) 이렇게 된다.
 * 그때 뒤로 읽으면 **첫 자리가 주소판 한 장뿐**이 되는데, 그 한 장은 거기서 무슨 일을 했는지
 * 말해 주지 못하고 그 뒤로 자리가 통째로 한 장씩 밀린다. 앞으로 읽으면 잘린 자국이
 * **맨 끝**에 남는다. 잘린 쪽은 끝이니 그쪽이 맞다.
 *
 * **시각을 알면 그보다 먼저 시각으로 읽는다.** 주소판마다 앞 장과의 간격과 뒷 장과의 간격을 견준다.
 * 한 자리 안은 분 단위이고 자리 사이는 걸어가는 시간이다. 주소판 **뒤**가 더 벌어졌으면 그 장은
 * 자리의 끝(뒤에 찍는 사람)이고, **앞**이 더 벌어졌으면 자리의 시작이다. 주소판마다 표를 내고 많은 쪽.
 * 양 끝 장수를 세는 위 규칙은 마지막 자리에 주소판이 없는 날 그쪽으로 기울었다. 실물 30장(자리 10,
 * 주소판은 늘 자리의 끝, 마지막 자리만 주소판 없이 석 장)에서 앞 2장 대 뒤 3장으로 「앞」이 되어
 * 자리마다 옆 주소가 붙고 17자리·모르겠음 9가 나왔다. 간격으로는 9표 대 0표로 「뒤」다.
 *
 * 표는 **한쪽이 분명히 더 벌어졌을 때만**(큰 쪽이 작은 쪽의 두 배 하고도 1분 이상) 낸다. 치우는 데 2분,
 * 걸어가는 데 1분이면 간격만으로는 어느 쪽도 못 정한다. 그런 주소판은 표를 안 내고, 표가 하나도 없거나
 * 같으면 양 끝 장수 규칙으로 돌아간다.
 */
export function wherePlate(plateAt: boolean[], stamps: Array<ShotStamp | null> = []): "leading" | "trailing" {
  const first = plateAt.indexOf(true);
  if (first < 0) return "trailing";
  const last = plateAt.lastIndexOf(true);

  let leading = 0;
  let trailing = 0;
  for (let i = 0; i < plateAt.length; i++) {
    if (!plateAt[i]) continue;
    const before = i > 0 ? minutesBetween(stamps[i - 1] ?? null, stamps[i] ?? null) : null;
    const after = i < plateAt.length - 1 ? minutesBetween(stamps[i] ?? null, stamps[i + 1] ?? null) : null;
    if (before === null || after === null || before < 0 || after < 0) continue;
    if (Math.max(before, after) < 2 * Math.min(before, after) + 1) continue;
    if (after > before) trailing++;
    else leading++;
  }
  if (leading !== trailing) return leading > trailing ? "leading" : "trailing";

  const head = first;
  const tail = plateAt.length - 1 - last;
  if (head !== tail) return head < tail ? "leading" : "trailing";
  return plateAt[0] ? "leading" : "trailing";
}

/**
 * 그날의 리듬. 주소판이 든 자리가 보통 몇 장인가.
 *
 * 한 사람이 하루를 도는 방식은 자리마다 크게 안 바뀐다. 전·후 두 장에 주소판 한 장이면
 * 내내 석 장이고, 전·후를 두 장씩 찍는 사람이면 내내 다섯 장이다. 그래서 **그날 사진이
 * 스스로 잣대를 준다.** 설정에 적어 둔 숫자보다 이쪽이 낫다. 동마다 사람마다 다르기 때문이다.
 *
 * **과반이 같은 길이일 때만** 리듬으로 친다. 길이가 들쭉날쭉하면 잣대로 삼을 것이 없다.
 * 그때는 설정값으로 끊되 **문턱을 두 자리 몫으로 높인다**. 리듬을 모르면서 바짝 자르면
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

  // 과반이 같은 길이다. 그것이 그날의 리듬이고, 잣대도 그 길이다.
  // 다만 「주소판 한 장」이 과반이면 리듬이 아니라 주소판 앞뒤 판독이 틀렸다는 신호다. 그 길이로
  // 자르면 자리마다 낱장이 된다. 그때는 설정값으로 느슨하게 끊는다.
  if (best <= 1) return loose;
  return most * 2 > sizes.length ? { size: best, limit: best } : loose;
}

/**
 * 뒤에 찍는 사람의 주소판 경계 가운데, 바로 뒤가 분명한 「후」 사진이면 그 경계를 거둔다(`buildGroups` ② 보탬).
 * 조건 셋: 앞 장과 같은 분 안 · 이 장이 「후」이고 「전」은 분명히 아님 · 이 자리(직전 경계 뒤)에 아직 그런 「후」가 없음.
 * 시각을 모르는 장은 안 건드린다. 어느 자리 것인지 알 길이 없다.
 */
function keepAfterShotWithPlate(
  byPlate: boolean[],
  byTime: boolean[],
  indices: number[],
  byIndex: Map<number, Judged>,
  stamps: Record<number, ShotStamp | null>,
  thresholds: Thresholds,
): void {
  // 「후」로 나왔고 「전」일 확률이 문턱의 나머지(0.2) 아래면 된다. 이런 장은 후·해당없음 사이에서 흔들려
  // 「후」 확신이 0.6~0.75 에 그치는데(09-26 실물 넷 전부), 자리를 새로 여는 것은 「전」이니 그것만 아니면 된다.
  const notBefore = 1 - workShotOf(thresholds);
  const isAfter = (i: number) => {
    const judgment = byIndex.get(indices[i]);
    return judgment?.stage === "after" && (judgment.stageProbabilities?.before ?? 1) <= notBefore;
  };
  let pieceHasAfter = false;
  for (let i = 0; i < indices.length; i++) {
    if (i === 0 || byTime[i]) {
      pieceHasAfter = isAfter(i);
      continue;
    }
    if (byPlate[i]) {
      const gap = minutesBetween(stamps[indices[i - 1]], stamps[indices[i]]);
      const close = thresholds.sameMinutes > 0 && gap !== null && gap >= 0 && gap <= thresholds.sameMinutes;
      if (close && !pieceHasAfter && isAfter(i)) {
        byPlate[i] = false;
        pieceHasAfter = true;
        continue;
      }
      pieceHasAfter = isAfter(i);
      continue;
    }
    if (isAfter(i)) pieceHasAfter = true;
  }
}

/** 주소판이 정하는 경계. 앞에 찍는 사람이면 주소판 **앞에서**, 뒤에 찍는 사람이면 주소판 **뒤에서** 끊는다. */
function plateCuts(plateAt: boolean[], role: "leading" | "trailing"): boolean[] {
  return plateAt.map((nowPlate, i) => {
    if (i === 0) return false;
    return role === "leading" ? nowPlate : plateAt[i - 1];
  });
}

/**
 * 갈래가 정하는 경계.
 *
 * 한 자리의 석 장은 갈래가 서로 달라 보인다. 치우기 전은 「순찰사항」, 치운 뒤는 「모르겠음」,
 * 주소판도 「모르겠음」. 그래서 갈래가 다르다고 무조건 끊으면 자리가 낱장으로 흩어진다.
 * 끊는 것은 **이어 오던 자리가 이미 한 갈래를 문턱 위로 정했고, 이 장도 다른 갈래를 문턱 위로
 * 말할 때**뿐이다. 「모르겠음」과 주소판은 어느 쪽에도 표를 안 낸다.
 *
 * 그늘막이 그 경우다. 청소 자리를 끝내고 걸어가다 그늘막을 한 장 찍으면 앞 장과 2분 안이라
 * 시각 잇기가 그 자리에 붙였고, 일지에는 청소 자리 주소 뒤에 그늘막이 딸려 나갔다.
 * 반대로 그늘막 뒤에 다음 청소 자리가 오면 그늘막이 그 자리 주소를 물려받았다.
 *
 * 시각·주소판이 이미 끊은 자리에서는 이어 오던 갈래를 새로 센다. 그 둘이 그은 선을 여기서
 * 다시 긋지 않는다.
 *
 * 끊는 자리의 **양쪽 가운데 한쪽은 확인 사진**(전·후가 「해당 없음」, 그 확신이 `workShot` 이상)이어야 한다.
 * 그늘막·배수구·위험시설물 사진이 그렇다. 치운 뒤 사진은 배수구가 드러나 「계절특수」 0.8 로 나오는 날이
 * 있고(실물 12번 장), 「해당 없음」 0.69~0.78 로 애매하게 나오는 날도 있다(실물 18·24번 장). 그 장으로 끊으면
 * 청소 자리의 전·후가 갈린다. 그래서 확신이 문턱 아래인 장은 확인 사진으로 안 치고, **바로 앞 장이 분명한
 * 「전」 사진이면** 이 장은 그 자리의 후 사진이라 보고 끊지 않는다. 전 사진 뒤에는 늘 후 사진이 온다.
 * 확인 사진 뒤에 다음 자리의 「전」 사진이 오는 것(그늘막 → 청소 자리)은 끊는다.
 */
function laneCuts(
  indices: number[],
  plateAt: boolean[],
  byIndex: Map<number, Judged>,
  thresholds: Thresholds,
  cutBefore: (i: number) => boolean,
): boolean[] {
  const cuts = indices.map(() => false);
  let running: Lane | null = null;
  /** 이어 오던 갈래를 정한 장이 확인 사진이었나. */
  let runningIsCheck = false;
  const sure = workShotOf(thresholds);
  for (let i = 0; i < indices.length; i++) {
    const judgment = byIndex.get(indices[i]);
    const mine = plateAt[i] ? null : sureLane(judgment, thresholds);
    const check =
      judgment?.stage === "not_applicable" && (judgment.stageProbabilities?.not_applicable ?? 0) >= sure;
    if (i === 0 || cutBefore(i)) {
      running = mine;
      runningIsCheck = Boolean(mine) && check;
      continue;
    }
    if (mine && running && mine !== running) {
      if (!check && !runningIsCheck) continue;
      // 바로 앞 장이 분명한 「전」이면 이 장은 그 자리의 후다. 갈래가 달라 보여도 한 자리.
      const previous = byIndex.get(indices[i - 1]);
      if (previous?.stage === "before" && (previous.stageProbabilities?.before ?? 0) >= sure) continue;
      cuts[i] = true;
      running = mine;
      runningIsCheck = check;
      continue;
    }
    if (mine && !running) {
      running = mine;
      runningIsCheck = check;
    }
  }
  return cuts;
}

/**
 * 같은 분 안에 주소판이 둘 붙어 있으면 한 자리의 것이다. **더 분명한 쪽만 주소판으로 친다.**
 *
 * 치운 뒤 사진 구석에 옆 건물 주소판이 잡히면 모델이 그 글자를 적어 오고, Jev 도 「주소판 글자다」
 * 0.9 를 준다. 전·후 확신이 문턱(`workShot`)에 못 미치면 `isWorkShot` 도 못 가려낸다(실물 24번 장:
 * 후 0.66 · 주소판 글자 0.92 · 옆집 주소). 그러면 그 장에서 자리가 끊기고 **옆집 주소가 이 자리에 붙는다.**
 * 바로 다음 장이 진짜 주소판(「해당 없음」 0.94 · 0.98)이었다. 둘을 견줘 「해당 없음」 확신과 주소판
 * 확률의 합이 큰 쪽을 남긴다. 진짜 주소판을 두 번 찍은 날에는 어느 쪽을 남겨도 같은 자리다.
 * 시각을 모르는 날에는 안 한다. 붙어 있다는 것을 알 길이 없다.
 */
function demoteTwinPlates(
  plateAt: boolean[],
  indices: number[],
  byIndex: Map<number, Judged>,
  stamps: Record<number, ShotStamp | null>,
  thresholds: Thresholds,
): void {
  if (thresholds.sameMinutes <= 0) return;
  const score = (i: number) => {
    const judgment = byIndex.get(indices[i]);
    return (judgment?.stageProbabilities?.not_applicable ?? 0) + (judgment?.addressPlate ?? 0);
  };
  for (let i = 1; i < indices.length; i++) {
    if (!plateAt[i - 1] || !plateAt[i]) continue;
    const gap = minutesBetween(stamps[indices[i - 1]], stamps[indices[i]]);
    if (gap === null || gap < 0 || gap > thresholds.sameMinutes) continue;
    if (score(i - 1) < score(i)) plateAt[i - 1] = false;
    else plateAt[i] = false;
  }
}

/** 이 장이 문턱 위로 말하는 실질 갈래. 없으면 null. 「모르겠음」은 갈래가 아니다. */
function sureLane(judgment: Judged | undefined, thresholds: Thresholds): Lane | null {
  if (!judgment) return null;
  let best: Lane = REAL_LANES[0];
  for (const lane of REAL_LANES) {
    if ((judgment.laneProbabilities[lane] ?? 0) > (judgment.laneProbabilities[best] ?? 0)) best = lane;
  }
  return (judgment.laneProbabilities[best] ?? 0) >= thresholds.lane ? best : null;
}

/**
 * 주소판이 **안 들어 있는** 덩이만 더 쪼갠다.
 *
 * 주소판이 있으면 그 덩이가 곧 한 자리다. 같은자리 확률로 더 쪼개지 않는다.
 * 그 확률은 캡션만 보고 내는 값이라, 치우기 전과 치운 뒤가 서로 달라 보이면 같은 자리인데도
 * 낮게 나온다(실물 18장 실측 중앙값 0.20). 그 값으로 주소판이 정해 준 자리를 쪼개면
 * 자리가 한 장씩 밀리고, 애써 읽은 주소가 옆자리 것이 된다.
 *
 * 주소판이 없는 덩이에서는 기댈 것이 확률과 시각뿐이다. 그때는 **애매하면 나눈다**.
 * 나눠 둔 둘을 사람이 합치는 것은 한 번이면 되지만, 잘못 합친 하나를 나누는 것은 번거롭다.
 *
 * 한 가지 안전망. 주소판이 든 덩이가 **그날의 리듬보다 길면** 그 자리에 남의 것이 섞인 것이다.
 * 주소판 한 장을 놓쳤거나(흐리게 찍힘), 청소와 상관없는 사진이 끼어들었거나.
 * 그대로 두면 **딴 사진이 남의 주소를 물려받는다.** 그때는 주소판 쪽에서부터 리듬만큼 끊고
 * 남는 것은 주소 없는 자리로 떼어낸다. 확률로 끊으면 중앙값 0.20 이라 낱장으로 흩어진다.
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
      // 판정이 아예 없다(키 없이 도는 경우). 그때는 장수로 끊는다. 마지막 수단이다.
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
 * **주소판 글자를 적어 왔는가**. 뒤엣것이 더 곧다. 모델은 간판·현수막·전화번호·차량번호를
 * 주소판으로 적지 말라고 못 박혀 있어서, 글자가 적혀 왔다면 주소판이 프레임에 있었다는 뜻이다.
 *
 * 확률 하나만 보면 한 장을 놓치는 날이 있고, 그 한 장 때문에 두 자리가 한 자리로 붙는다.
 */
export function isPlate(
  judgment: Judged | undefined,
  signText: string | null | undefined,
  thresholds: Thresholds,
): boolean {
  // 전 또는 후 작업 사진이라고 Jev 가 분명히 봤으면 주소판이 아니다. 글자가 읽혀 왔어도 그렇다.
  if (isWorkShot(judgment, thresholds)) return false;
  if ((signText ?? "").trim().length > 0) return true;
  return (judgment?.addressPlate ?? 0) >= thresholds.addressPlate;
}

/**
 * **사진 칸에서 뺄** 주소판인가. 묶기(`isPlate`)보다 좁다.
 *
 * 묶기는 글자가 읽혔으면 주소판으로 친다. 자리를 끊는 데는 그게 맞다. 그러나 사진 칸을 고를 때 같은 기준을 쓰면
 * 치운 뒤 사진 벽에 붙은 작은 번호판(「9-1」)을 읽어 온 장이 주소판이 되어 **후 칸이 빈다**(09-26 실물: 옮겨 넣은 전
 * 사진만 남고 깨끗해진 출입구 사진이 빠졌다). 그래서 여기서는 Jev 가 낸 「주소판일 확률」이 문턱을 넘는 장만 뺀다.
 * 확률이 없는 옛 판정은 글자로 본다.
 */
export function isPlateShot(
  judgment: Judged | undefined,
  signText: string | null | undefined,
  thresholds: Thresholds,
): boolean {
  if (isWorkShot(judgment, thresholds)) return false;
  const score = judgment?.addressPlate;
  if (typeof score === "number") return score >= thresholds.addressPlate;
  return (signText ?? "").trim().length > 0;
}

/**
 * 이 장이 전 또는 후 작업 사진인가.
 *
 * 글자가 있으면 주소판으로 치는 규칙에는 구멍이 하나 있다. 치운 뒤 사진 구석에 길 표지판이나
 * 옆 건물 주소판이 잡히면 모델이 그 글자를 적어 온다. 그러면 그 장이 주소판이 되어 자리가
 * 거기서 끊기고, 진짜 주소판은 혼자 남아 다음 연번이 된다. 실물 30장 5회 가운데 3회가 그랬다.
 *
 * 그 장을 가려내는 값은 Jev 가 이미 내고 있다. 전·후를 묻는 답이다. 주소판 사진은 「해당 없음」으로
 * 나오고(실물 45장 전부 0.84 이상), 작업 사진은 전이나 후로 나온다. 확률이 문턱을 넘을 때만 믿는다.
 * 옛 판정(확률 없음)은 이 규칙을 안 탄다.
 */
function isWorkShot(judgment: Judged | undefined, thresholds: Thresholds): boolean {
  if (!judgment || judgment.stage === "not_applicable") return false;
  const sure = judgment.stageProbabilities?.[judgment.stage] ?? 0;
  return sure >= workShotOf(thresholds);
}

/** 옛 설정에 이 값이 없으면 0.8 로 본다. */
function workShotOf(thresholds: Thresholds): number {
  const value = thresholds.workShot;
  return typeof value === "number" && value > 0 ? value : 0.8;
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
  described: Described[],
): Group {
  // 주소는 주소판에서만 온다. 없으면 빈 칸으로 둔다. 지어낸 주소가 없는 것보다 위험하다.
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

  const group: Group = {
    id: `g${photos[0]}`,
    photos,
    address,
    lane: decideLane(photos, byIndex, thresholds, plates),
    edited: false,
    time: clocks[0] ?? "",
  };
  return markShade(group, described);
}

/**
 * 그늘막 자리를 표시하고, 갈래가 안 선 자리는 계절특수로 올린다.
 *
 * Jev 는 그늘막 사진을 「모르겠음」으로 두는 날이 많다(자료 사진 5장 가운데 4장). 질문은 안 고치므로
 * 앞 단계가 적어 온 글에서 코드가 읽는다. 주소판 글자가 있으면 주소판으로 치는 것과 같은 급의 규칙이다.
 * Jev 가 다른 갈래를 분명히 정한 자리는 안 건드린다. 사람이 고친 자리는 `app.tsx` 가 같은 함수로 다시 읽는다.
 */
export function markShade(group: Group, described: Described[]): Group {
  if (group.lane !== "unknown" && group.lane !== "flood_season") return group;
  if (!isShadeSpot(group.photos, described)) return group;
  return { ...group, lane: "flood_season", shade: true };
}

/**
 * 이 자리가 그늘막인가.
 *
 * 계절특수 갈래는 배수구와 그늘막을 한 란에 담는다(일지의 란이 그렇다). 그런데 일지에 적는
 * 말은 다르다. 배수구는 「주변 폐기물 처리 및 수거」, 그늘막은 「점검」이다. 갈래를 하나 더
 * 만들면 질문(judgment.ts)을 고쳐야 하니, 어느 쪽인지는 **앞 단계가 적어 온 글에서 코드가
 * 읽는다**. 사진을 읽은 모델은 본 것만 적으므로 그늘막이 있었으면 그 말이 캡션에 있다.
 * 사람이 자리에 말을 정해 두었으면 그쪽이 이긴다(report.ts).
 */
export function isShadeSpot(photos: number[], described: Described[]): boolean {
  const byIndex = new Map(described.map((d) => [d.index, d]));
  return photos.some((index) => {
    const one = byIndex.get(index);
    if (!one) return false;
    return SHADE_WORDS.test(`${one.caption} ${one.captionKo ?? ""} ${one.textInPhoto ?? ""}`);
  });
}

/** 캡션에 이 말이 있으면 그늘막 자리. 영어 캡션이 판정에 쓰는 원문이라 영어가 먼저다. */
const SHADE_WORDS = /sunshade|sun shade|shade|canop|parasol|awning|pergola|shelter|covered structure|roofed structure|bus stop|그늘막/i;

/**
 * 묶음의 갈래 = **가장 센 한 장**이 정한다. 평균이 아니다.
 *
 * 한 자리에서 찍는 석 장은 같은 것을 세 번 찍은 것이 아니라 **역할이 다르다**.
 * 치우기 전, 치운 뒤, 그리고 주소판. 치운 뒤 사진이 「아무것도 아님」으로 나오는 것은
 * 맞는 답이지 반증이 아니다. 그런데 평균을 내면 0.98 짜리 한 장이 0.49 로 깎여
 * 문턱 아래로 내려간다. 실물 30장(자리 10곳)에서 그래서 9곳이 「모르겠음」이 됐다.
 * 가장 센 장으로 바꾸니 틀린 것 없이 5곳이 제자리를 찾았다.
 *
 * 대신 문턱은 높게 둔다(기본 0.8). 한 장만 보고 정하는 것이니 그 한 장은 분명해야 한다.
 *
 * 한 가지가 이보다 앞선다. **「치우기 전」이라고 분명히 본 장**(`workShot` 이상)이 있고 그 장의 제일 센 갈래가
 * 순찰사항이면(문턱의 반은 넘어야 한다) 그 자리는 순찰사항이다. 치우기 전 사진이 있다는 것은 거기서 치웠다는
 * 뜻이고, 그건 순찰사항 란의 일이다. 실물 30장에서 청소 자리 셋이 순찰사항 0.71·0.68·0.59 로 「모르겠음」이
 * 됐는데 셋 다 「치우기 전」 0.85 이상이었다. 다른 회차에서는 같은 자리의 치운 뒤 사진이 옹벽 때문에
 * 「위험시설물」 0.83 으로 나와 자리가 위험시설물이 됐다. 서로 다른 두 질문이 같은 쪽을 가리키는 전 사진이
 * 한 장의 센 값보다 낫다. 위험시설물 사진도 「전」으로 나오는 날이 있지만 그 장은 제일 센 갈래가 위험시설물이라
 * 여기 안 걸리고, 배수구 청소의 전 사진은 계절특수가 제일 세서 역시 안 걸린다.
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

  // 치우기 전 사진이 분명하고 그 장이 순찰사항 쪽이면 순찰사항. 다른 장의 값보다 앞선다.
  const before = photos.some((index) => {
    const judgment = byIndex.get(index);
    if (!judgment || judgment.stage !== "before" || (plates?.has(index) ?? false)) return false;
    if ((judgment.stageProbabilities?.before ?? 0) < workShotOf(thresholds)) return false;
    // 순찰사항이 제일 세되, 문턱의 반은 넘어야 한다. 셋 다 낮은 장은 아무 말도 안 한 것이다.
    if (judgment.laneProbabilities.waste_cleanup < thresholds.lane / 2) return false;
    return REAL_LANES.every((lane) => judgment.laneProbabilities[lane] <= judgment.laneProbabilities.waste_cleanup);
  });
  if (before) return "waste_cleanup";

  let best: Lane = REAL_LANES[0];
  for (const lane of REAL_LANES) {
    if (deciding.laneProbabilities[lane] > deciding.laneProbabilities[best]) best = lane;
  }

  // 그 한 장조차 분명하지 않으면 비워 두고 사람에게 넘긴다.
  return deciding.laneProbabilities[best] < thresholds.lane ? "unknown" : best;
}

/**
 * 묶음의 갈래를 정한 그 한 장. 화면의 막대가 이 장의 분포를 그린다.
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

/**
 * 워터마크 연도 오독 바로잡기.
 *
 * 사진에 찍힌 「2026년 9월 23일 오전 9:32」 를 모델이 「2025년 …」 으로 옮겨 적은 날이 있었다(09-26 실물, 서른 장 가운데
 * 한 장). 그 한 장은 하루가 아니라 한 해 앞으로 밀려 맨 앞에 혼자 서고, 같은 주소판 앞에서 찍은 두 장과 갈라졌다.
 * 하루치 사진이니 날짜는 대개 하나다. **월·일은 같고 연도만 다른** 장을 그날 과반 날짜로 맞춘다. 월·일까지 다르면
 * 손대지 않는다(정말 다른 날 사진일 수 있다). 과반 날짜가 없어도 손대지 않는다.
 */
export function snapYears(stamps: Record<number, ShotStamp | null>): Record<number, ShotStamp | null> {
  const dates = Object.values(stamps).flatMap((stamp) => (stamp?.date ? [stamp.date] : []));
  if (dates.length < 2) return stamps;
  const count = new Map<string, number>();
  for (const date of dates) count.set(date, (count.get(date) ?? 0) + 1);
  const [common, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n * 2 <= dates.length) return stamps;
  const out: Record<number, ShotStamp | null> = { ...stamps };
  for (const [key, stamp] of Object.entries(stamps)) {
    if (!stamp?.date || stamp.date === common) continue;
    if (stamp.date.slice(5) === common.slice(5)) out[Number(key)] = { ...stamp, date: common };
  }
  return out;
}

/**
 * 시각을 아예 모르는 장에게 **올라온 차례의 옆 장** 시각을 빌려 준다.
 *
 * 시각 없는 장은 줄 세우기에서 맨 뒤로 빠져 제 자리에 못 들어간다(09-26 실물: 청소 뒤 사진 한 장이 워터마크도 없이 와서
 * 그 자리의 전 사진과 갈라졌다). 폰 사진첩에서 고른 차례는 대개 찍은 차례라, 바로 앞 장(없으면 뒤 장)과 같은 분으로
 * 보면 시각 규칙이 그 자리로 이어 준다. 빌린 장은 `borrowed` 를 달아 화면이 「옆 장 시각」이라고 적는다.
 *
 * 시각을 아는 장이 **과반일 때만** 빌린다. 메신저를 거쳐 시각이 다 벗겨진 서른 장에 한 장만 시각이 있으면, 전부 그 한 장
 * 시각을 빌려 한 자리로 뭉치게 된다. 그런 회차는 지금처럼 장수로 끊는 편이 낫다.
 *
 * 그리고 **연속 두 장까지만** 빌린다(09-26 실물 66장). 시각 없는 장이 열넷 연달아 오면 전부 한 분을 빌려 한 덩이가 되고,
 * 그 안 차례는 올라온 차례뿐이라 리듬으로 잘리며 자리마다 한 장씩 밀렸다. 한두 장이 빠진 것은 「그 자리 사진 한 장이 시각을
 * 잃은 것」이고, 열 장이 빠진 것은 「시각이 없는 무리」다. 뒤엣것은 시각 모르는 장으로 두어 따로 묶는다(`buildGroups` 첫 줄).
 */
const BORROW_RUN_MAX = 2;
export function borrowStamps<T extends { index: number }>(
  items: T[],
  stamps: Record<number, ShotStamp | null>,
): Record<number, ShotStamp | null> {
  const sorted = [...items].sort((a, b) => a.index - b.index);
  const timed = sorted.filter((one) => stamps[one.index]).length;
  if (timed === 0 || timed * 2 < sorted.length) return stamps;
  const out: Record<number, ShotStamp | null> = { ...stamps };
  // 시각 없는 장이 연달아 몇 장인지 먼저 잰다. 긴 무리는 안 빌린다.
  const runLength: number[] = sorted.map(() => 0);
  for (let i = 0; i < sorted.length; ) {
    if (stamps[sorted[i].index]) { i++; continue; }
    let j = i;
    while (j < sorted.length && !stamps[sorted[j].index]) j++;
    // 앞뒤 이웃이 멀리 벌어진 무리는 어느 쪽 것인지 모른다. 그래도 안 빌리지는 않는다(09-26 실물에서 시험):
    // 올라온 차례가 시각 차례와 다르면 무리 끝 장의 「다음 이웃」이 엉뚱한 장이라, 멀쩡히 붙던 자리까지 떨어졌다.
    for (let k = i; k < j; k++) runLength[k] = j - i;
    i = j;
  }
  const allowed = (i: number) => runLength[i] > 0 && runLength[i] <= BORROW_RUN_MAX;
  for (let i = 1; i < sorted.length; i++) {
    const me = sorted[i].index;
    const before = out[sorted[i - 1].index];
    if (!out[me] && before && allowed(i)) out[me] = { ...before, borrowed: true };
  }
  for (let i = sorted.length - 2; i >= 0; i--) {
    const me = sorted[i].index;
    const after = out[sorted[i + 1].index];
    if (!out[me] && after && allowed(i)) out[me] = { ...after, borrowed: true };
  }
  return out;
}
