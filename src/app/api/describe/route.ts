import { loadConfig, readKey } from "@/core/config";
import { describePhotos, type PhotoInput } from "@/core/describe";
import { loadDong } from "@/core/road-index";
import { hasPass, takeQuota, whoFrom } from "@/core/demo-limit";

/**
 * 사진 → 글. 키는 서버에만 있고 브라우저로 내려가지 않는다.
 *
 * 브라우저는 몇 장씩 나눠 보낸다. 요청 몸집을 작게 유지하고,
 * 한 장이 끝날 때마다 화면이 바로 차오르게 하려고.
 */
export async function POST(request: Request) {
  const apiKey = readKey("OPENAI_API_KEY");
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY 가 없습니다. .env.local 에 넣고 다시 띄워 주세요." },
      { status: 503 },
    );
  }

  let photos: PhotoInput[];
  let dong: string | null = null;
  try {
    ({ photos, dong = null } = (await request.json()) as { photos: PhotoInput[]; dong?: string | null });
  } catch {
    return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }
  if (!Array.isArray(photos) || photos.length === 0) {
    return Response.json({ error: "사진이 없습니다." }, { status: 400 });
  }

  // 맛보기 한도. 공개한 자리에서만 켜진다(PATROL_DEMO_PHOTOS_PER_DAY).
  const quota = takeQuota(whoFrom(request), photos.length, hasPass(request));
  if (!quota.ok) {
    return Response.json(
      {
        error:
          `맛보기는 하루 ${quota.limit}장까지입니다(오늘 ${quota.left}장 남음). ` +
          "더 쓰시려면 github.com/patrol-jev/patrol-jev 를 받아 본인 키로 돌리세요. 장수 제한이 없습니다.",
      },
      { status: 429 },
    );
  }

  try {
    // 담당자가 고른 동의 도로명 색인. 없으면 읽은 주소를 그대로 쓴다.
    const described = await describePhotos(photos, loadConfig(), apiKey, loadDong(dong));
    return Response.json({ described });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 502 });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "사진을 읽는 중에 실패했습니다.";
}
