import { dropDevice, isId, putJobs, readJobs, readSubscription, vapidKeys } from "@/core/overtime/push";

/**
 * 초과기록 진동 알림을 맡기고 거두는 자리.
 *
 * 받는 것: 기기 번호(화면이 지어낸 무작위 값), 알림 주소, 울릴 시각과 칸 번호·날짜.
 * 받지 않는 것: 이름, 근무시간, 사유. 요청을 기록하지 않는다.
 */

/** 공개키. 없으면 이 서버는 알림을 맡지 않는다. */
export function GET() {
  return Response.json({ publicKey: vapidKeys()?.publicKey ?? null });
}

/** 이 기기의 알림을 통째로 바꿔 넣는다. */
export async function POST(request: Request) {
  if (!vapidKeys()) return Response.json({ ok: false, why: "off" }, { status: 503 });
  const text = await request.text();
  if (text.length > 32_000) return Response.json({ ok: false, why: "big" }, { status: 413 });
  let body: { id?: unknown; subscription?: unknown; jobs?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, why: "json" }, { status: 400 });
  }
  const subscription = readSubscription(body.subscription);
  if (!isId(body.id) || !subscription) return Response.json({ ok: false, why: "bad" }, { status: 400 });
  const done = putJobs(body.id, subscription, readJobs(body.jobs, Date.now()));
  return Response.json(done, { status: done.ok ? 200 : 503 });
}

/** 알림을 끈다. 이 기기 것을 모두 지운다. */
export async function DELETE(request: Request) {
  let body: { id?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // 빈 몸통이면 아래에서 거른다.
  }
  if (!isId(body.id)) return Response.json({ ok: false }, { status: 400 });
  dropDevice(body.id);
  return Response.json({ ok: true });
}
