import { loadConfig, readKey } from "@/core/config";
import { JevFirstPass, NoFirstPass } from "@/core/jev";
import type { FirstPass, FirstPassInput } from "@/core/types";

/**
 * 글 → 판정. 한 장에 한 번 부르고, 그 한 번에 질문 넷을 같이 싣는다.
 * 사진은 여기까지 오지 않는다 — 넘어오는 것은 앞 단계가 적은 글뿐이다.
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

  try {
    const judged = await firstPass.decide(items);
    return Response.json({ judged, firstPass: firstPass.name });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 502 });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "판정 중에 실패했습니다.";
}
