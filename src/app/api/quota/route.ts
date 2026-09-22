import { hasPass, leftFor, whoFrom } from "@/core/demo-limit";

/**
 * 오늘 몇 장 더 읽어 주는지.
 *
 * 화면이 사진을 보내기 **전에** 알아야 한다. 30장을 올렸다가 10장에서 멈추는 것이 제일 나쁘다.
 * 여기서는 세지 않는다. 보기만 한다.
 */
export async function GET(request: Request) {
  const free = hasPass(request);
  const { limit, left } = leftFor(whoFrom(request), free);

  return Response.json({
    /** 0 이면 한도가 없다. 화면은 아무 말도 하지 않는다. */
    limit,
    left: Number.isFinite(left) ? left : null,
    free,
  });
}
