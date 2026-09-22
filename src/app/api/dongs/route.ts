import { listDongs } from "@/core/road-index";

/**
 * 고를 수 있는 동 목록. 담당자가 자기 동을 고르면 그 동의 도로명으로 주소를 대조한다.
 *
 * 색인을 안 만들었으면 빈 목록이 온다. 화면은 그때 만드는 법을 알려 준다.
 */
export async function GET() {
  const dongs = listDongs();
  return Response.json({ dongs, ready: dongs.length > 0 });
}
