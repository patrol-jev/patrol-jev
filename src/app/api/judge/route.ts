import { loadConfig, readKey } from "@/core/config";
import { JevFirstPass, NoFirstPass } from "@/core/jev";
import type { FirstPass, FirstPassInput } from "@/core/types";

/**
 * 글 → 판정. 한 장에 한 번 부르고, 그 한 번에 질문 넷을 같이 싣는다.
 * 사진은 여기까지 오지 않는다. 넘어오는 것은 앞 단계가 적은 글뿐이다.
 */
export async function POST(request: Request) {
  const config = loadConfig();
  const apiKey = readKey("TYPESAFE_API_KEY");

  let items: FirstPassInput[];
  try {
    ({ items } = (await request.json()) as { items: FirstPassInput[] });
  } catch {
    return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "판정할 것이 없습니다." }, { status: 400 });
  }

  // 키가 없거나 꺼 두었으면 판정 없이 돈다. 전부 「모르겠음」이 되고 사람이 정한다.
  const firstPass: FirstPass =
    config.firstPass.enabled && apiKey ? new JevFirstPass(config, apiKey) : new NoFirstPass();

  // 서버 콘솔 한 줄. 라우트가 걸린 시간과 Jev 가 걸린 시간을 나란히 적는다.
  // 둘이 비슷하면 모델 쪽, 라우트만 길면 서버 쪽(개발 서버의 첫 컴파일 같은)이다.
  // 밖으로 보내는 로그가 아니다. 장수와 밀리초뿐, 글도 주소도 없다.
  const started = Date.now();
  inFlight += 1;
  const waiting = inFlight;
  try {
    const judged = await firstPass.decide(items);
    const jevMs = judged.reduce((sum, one) => sum + one.ms, 0);
    console.log(`judge ${items.length}장 ${Date.now() - started}ms (jev ${jevMs}ms, 동시 ${waiting})`);
    return Response.json({ judged, firstPass: firstPass.name });
  } catch (error) {
    console.log(`judge ${items.length}장 실패 ${Date.now() - started}ms (동시 ${waiting})`);
    return Response.json({ error: message(error) }, { status: 502 });
  } finally {
    inFlight -= 1;
  }
}

/** 지금 이 서버에서 같이 도는 judge 요청 수. 화면은 동시성 8 로 장마다 한 번 부른다. */
let inFlight = 0;

function message(error: unknown): string {
  return error instanceof Error ? error.message : "판정 중에 실패했습니다.";
}
