import { mapForm } from "@/core/form-map";
import { openHwpx } from "@/core/hwpx/read";
import { mapPeriodForm } from "@/core/period-form-map";

/**
 * 부서 양식 hwpx → 칸 지도.
 *
 * 파일은 **읽고 버린다.** 저장하지 않고 기록에도 안 남긴다. 돌려주는 것은 어느 셀이 어느 자리인지와
 * 양식에서 읽은 라벨뿐이다. 채우기는 브라우저가 한다. 사진은 여기로 오지 않는다.
 *
 * `?kind=period` 면 결과 보고서 양식이다. 일지 양식은 「라벨 → 옆 값 칸」, 결과 보고서 양식은 「표 네 종류」로 읽는다.
 */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") === "period" ? "period" : "ilji";
  let file: File | null = null;
  try {
    const form = await request.formData();
    const got = form.get("file");
    if (got instanceof File) file = got;
  } catch {
    return Response.json({ error: "양식 파일을 받지 못했습니다." }, { status: 400 });
  }
  if (!file) return Response.json({ error: "양식 파일이 없습니다." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "양식 파일이 8MB 를 넘습니다." }, { status: 413 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = openHwpx(bytes);
    const map = kind === "period" ? mapPeriodForm(doc) : mapForm(doc);
    return Response.json({ kind, map });
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : "읽지 못했습니다.";
    return Response.json({ error: `hwpx 로 읽지 못했습니다. ${why}` }, { status: 422 });
  }
}
