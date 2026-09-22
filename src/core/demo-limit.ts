/**
 * 맛보기 한도.
 *
 * 누구나 열어 볼 수 있는 곳에 올려 두면 **내 키로 남의 사진을 읽게 된다.** 몇 사람이면
 * 괜찮지만 천 명이면 감당이 안 된다. 그래서 공개한 자리에서는 하루에 몇 장까지만 읽어 주고,
 * 더 쓰려는 사람에게는 레포를 받아 자기 키로 돌리라고 안내한다.
 *
 * **환경변수를 넣은 곳에서만 켜진다**(`PATROL_DEMO_PHOTOS_PER_DAY`). 안 넣으면 한도가 없다.
 * 자기 컴퓨터에 받아 자기 키로 쓰는 사람을 막을 이유가 없다.
 *
 * 세는 것은 **오늘 몇 장을 읽었는가**뿐이다. 사진도, 주소도, 무엇을 올렸는지도 남기지 않는다.
 * 메모리에만 두므로 서버를 다시 띄우면 0 부터다. 완벽한 방어가 아니라 **사고 방지턱**이다.
 */

interface Used {
  day: string;
  photos: number;
}

const used = new Map<string, Used>();

/**
 * 한도를 건너뛰는 열쇠.
 *
 * 만든 사람과 같이 봐 주는 사람은 한도 없이 써야 한다. 그렇다고 IP 로 열어 주면 안 된다.
 * 휴대폰은 통신사 IP 가 수시로 바뀌어 며칠 뒤 또 막힌다. 그래서 **주소에 열쇠를 달아 한 번
 * 열면 그 기기가 기억하는** 방식으로 한다(`?pass=…`).
 *
 * 환경변수 `PATROL_DEMO_PASS` 를 안 넣으면 이 문은 아예 없다.
 */
export function hasPass(request: Request): boolean {
  const pass = process.env.PATROL_DEMO_PASS?.trim();
  if (!pass) return false;
  return request.headers.get("x-patrol-pass")?.trim() === pass;
}

/** 하루에 읽어 줄 장수. 0 이면 한도 없음. */
export function demoLimit(): number {
  const raw = Number(process.env.PATROL_DEMO_PHOTOS_PER_DAY ?? "0");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/**
 * 이번 요청의 몫을 뗀다. 남은 게 모자라면 거절한다.
 *
 * 한도를 안 걸었으면 언제나 통과한다.
 */
export function takeQuota(
  who: string,
  photos: number,
  free = false,
): { ok: boolean; left: number; limit: number } {
  const limit = demoLimit();
  if (limit === 0 || free) return { ok: true, left: Number.POSITIVE_INFINITY, limit: 0 };

  const day = new Date().toISOString().slice(0, 10);
  const seen = used.get(who);
  const already = seen && seen.day === day ? seen.photos : 0;

  if (already + photos > limit) return { ok: false, left: Math.max(0, limit - already), limit };

  used.set(who, { day, photos: already + photos });
  // 어제 것까지 들고 있을 이유가 없다.
  if (used.size > 5000) for (const [key, value] of used) if (value.day !== day) used.delete(key);

  return { ok: true, left: limit - already - photos, limit };
}

/** 세지 않고 지금 남은 장수만 본다. 화면이 「오늘 N장 남음」을 보일 때 쓴다. */
export function leftFor(who: string, free = false): { limit: number; left: number } {
  const limit = demoLimit();
  if (limit === 0 || free) return { limit: 0, left: Number.POSITIVE_INFINITY };

  const day = new Date().toISOString().slice(0, 10);
  const seen = used.get(who);
  const already = seen && seen.day === day ? seen.photos : 0;
  return { limit, left: Math.max(0, limit - already) };
}

/**
 * 누구의 몫인지. 앞단(Caddy)이 붙여 주는 주소를 쓰고, 없으면 한 덩이로 센다.
 * 주소는 세는 데만 쓰고 어디에도 적지 않는다.
 */
export function whoFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}
