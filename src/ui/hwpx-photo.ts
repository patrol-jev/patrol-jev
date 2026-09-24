"use client";

/**
 * 일지 사진 칸에 넣을 JPEG 를 **브라우저에서** 만든다.
 *
 * 사진 칸은 셀 배경으로 들어가고, 셀 배경은 셀 크기에 맞춰 늘어난다. 그래서 셀 비율(가로/세로)로
 * 미리 잘라 두어야 찌그러지지 않는다. 가운데를 남기고 남는 쪽을 잘라 낸다. 비율은 양식마다 다르니 받는다.
 * 서버로는 아무것도 안 간다. 파일은 이 자리에서 만들어 바로 내려받는다.
 */
export async function cellPhotoBytes(url: string | undefined, ratio: number): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    const width = 1180;
    const height = Math.max(200, Math.round(width / (ratio > 0 ? ratio : 1.25)));
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    bitmap.close();

    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    return jpeg ? new Uint8Array(await jpeg.arrayBuffer()) : null;
  } catch {
    // 한 장을 못 만들어도 일지는 나간다. 그 칸만 빈 채로 간다.
    return null;
  }
}

/** 바이트를 파일로 내려받게 한다. */
export function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/hwp+zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
