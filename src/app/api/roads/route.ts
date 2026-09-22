import { loadDong } from "@/core/road-index";

/**
 * 고른 동의 도로명 목록. **주소 칸 자동완성에 쓴다.**
 *
 * 수동 모드에서는 주소판을 읽어 줄 모델이 없다. 사람이 친다. 그런데 그 동의 도로명은
 * 이미 색인에 다 있으니, 세 자만 쳐도 나오게 하면 손으로 치는 수고가 거의 없어진다.
 * 오독을 고치는 것보다 애초에 목록에서 고르는 편이 빠르고 정확하다.
 *
 * 색인을 안 만들었으면 빈 목록이 온다 — 그때는 그냥 손으로 친다. 도구는 그대로 돈다.
 * 건물번호는 안 내려보낸다. 도로 하나에 수백 개라 목록이 쓸모없이 커지고,
 * 번호는 어차피 사람이 주소판을 보고 친다.
 */
export async function GET(request: Request) {
  const dong = new URL(request.url).searchParams.get("dong");
  const index = loadDong(dong);
  const roads = index ? Object.keys(index.buildings).sort((a, b) => a.localeCompare(b, "ko")) : [];

  return Response.json({ roads, ready: roads.length > 0 });
}
