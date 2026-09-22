"use client";

/**
 * 사진 준비는 **브라우저에서** 끝낸다.
 *
 * 원본은 서버로 가지 않는다. 긴 변을 줄인 사본만 간다. 그래야 싸고 빠르고,
 * 남는 것도 적다. 찍힌 시각도 여기서 읽는다(EXIF). 좌표는 읽지 않는다.
 */

export interface PreparedPhoto {
  index: number;
  name: string;
  /** 화면에 띄울 주소(브라우저 안에서만 산다). */
  url: string;
  /**
   * 서버로 보낼 base64. `data:` 접두 없음.
   * **수동 모드에서는 빈 문자열이다**. 사진을 아무 데도 안 보내니 만들 까닭이 없다.
   */
  data: string;
  mediaType: "image/jpeg";
  /** 찍힌 날짜 YYYY-MM-DD. 못 읽으면 빈 문자열. */
  date: string;
  /** 찍힌 시각 HH:MM. 못 읽으면 빈 문자열. */
  time: string;
/**
   * 찍힌 시각(ms). **모르면 0.**
   *
   * 파일 수정 시각으로 메우지 않는다. 내려받거나 옮긴 사진은 그 값이 촬영과 아무 상관이
   * 없어서, 그걸로 줄 세우면 사람이 고른 차례를 헝클어 놓는다.
   */
  sortKey: number;
}

/** 못 연 사진 한 장. 이름을 들고 다닌다. 「몇 장 실패」만으로는 어느 것인지 모른다. */
export interface FailedPhoto {
  name: string;
  why: string;
}

export interface Prepared {
  photos: PreparedPhoto[];
  /**
   * 무엇으로 줄 세웠는지. "time" = 찍힌 시각 · "given" = 올라온 차례 그대로.
   * 화면에 그대로 적는다. 차례가 곧 묶기라, 무엇으로 정했는지 안 보이면 왜 저렇게
   * 묶였는지 알 수 없다.
   */
  ordered: "time" | "given";
  /**
   * 못 연 사진들. **한 장이 안 열려도 나머지는 그대로 간다.**
   * 서른 장 가운데 한 장이 이상하다고 스물아홉 장을 버리면 그날 일지를 못 쓴다.
   */
  failed: FailedPhoto[];
}

/** 파일 고르기·끌어놓기에서 받아 줄 것. 확장자도 본다. HEIC 는 유형이 빈 채로 올 때가 있다. */
export function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp|gif|bmp|avif)$/i.test(file.name)
  );
}

/** 파일 고르기 창에 넘기는 값. `image/*` 만으로는 HEIC 가 안 보이는 기계가 있다. */
export const IMAGE_ACCEPT = "image/*,.heic,.heif";

export async function preparePhotos(
  files: File[],
  maxEdge: number,
  startIndex: number,
  /**
   * 서버로 보낼 base64 를 만들지. 수동 모드에서는 false. 사진이 브라우저 밖으로 안 나간다.
   * 30장이면 문자열 수 MB 를 만들었다 버리는 셈이라, 안 만들면 그만큼 빠르고 가볍다.
   */
  needData = true,
): Promise<Prepared> {
  const settled = await Promise.all(
    files.map(async (file) => {
      try {
        return { ok: true as const, photo: await prepareOne(file, maxEdge, needData) };
      } catch (cause) {
        return { ok: false as const, failed: { name: file.name, why: whyFailed(cause) } };
      }
    }),
  );

  const prepared = settled.flatMap((one) => (one.ok ? [one.photo] : []));
  const failed = settled.flatMap((one) => (one.ok ? [] : [one.failed]));

  /**
   * 찍힌 차례가 곧 순찰 동선이다. 묶기 규칙 전체가 이 차례에 기대고 있다.
   *
   * **모든 장의 찍힌 시각을 알 때만** 그 시각으로 줄 세운다. 한 장이라도 모르면
   * 올라온 차례를 그대로 둔다. 사람이 고른 차례가 그때는 가장 나은 증거다.
   * 파일 수정 시각이나 이름으로 메워 줄 세우면 조용히 틀린 차례를 만든다
   * (카카오톡에서 받은 사진은 첫 장 이름에만 번호가 없어 이름순에서 맨 뒤로 간다).
   */
  const ordered = prepared.every((photo) => photo.sortKey > 0) ? "time" : "given";
  if (ordered === "time") prepared.sort((a, b) => a.sortKey - b.sortKey);

  return {
    photos: prepared.map((photo, i) => ({ ...photo, index: startIndex + i })),
    failed,
    ordered,
  };
}

async function prepareOne(
  file: File,
  maxEdge: number,
  needData: boolean,
): Promise<Omit<PreparedPhoto, "index">> {
  const shot = await readShotTime(file);
  const bitmap = await toBitmap(file);

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이 브라우저에서는 사진을 줄일 수 없습니다.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82),
  );
  if (!blob) throw new Error("사진을 변환하지 못했습니다.");

  return {
    name: file.name,
    url: URL.createObjectURL(blob),
    data: needData ? await toBase64(blob) : "",
    mediaType: "image/jpeg",
    date: shot.date,
    time: shot.time,
    sortKey: shot.stamp,
  };
}

/**
 * 사진 한 장을 그릴 수 있는 꼴로.
 *
 * **아이폰은 기본이 HEIC 다.** 순찰 사진은 대개 거기서 온다. 그런데 브라우저는 HEIC 를
 * 못 연다. 「The source image could not be decoded.」가 그 소리다. 그래서 HEIC 일 때만
 * 변환 도구를 **그때 받아** 바꾼다. HEIC 를 안 올리는 사람에게까지 내려보낼 것이 아니다.
 *
 * 변환도 브라우저 안에서 끝난다. 원본은 여전히 나가지 않는다.
 */
async function toBitmap(file: File): Promise<ImageBitmap> {
  if (looksHeic(file)) return heicBitmap(file);

  try {
    return await createImageBitmap(file);
  } catch (cause) {
    // 이름이 `.jpg` 인데 속은 HEIC 인 파일이 있다. 메신저나 내려받기를 거치면 그렇게 된다.
    // 브라우저가 못 연 것만 바이트로 한 번 더 본다. 멀쩡한 사진에는 변환 도구를 안 받는다.
    const { isHeic } = await import("heic-to");
    if (await isHeic(file)) return heicBitmap(file);
    throw cause;
  }
}

/** 이번에 올린 것 가운데 HEIC 이 몇 장인가. 화면이 「변환에 한 번 걸립니다」를 말할 때 쓴다. */
export function countHeic(files: File[]): number {
  return files.filter(looksHeic).length;
}

function looksHeic(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type);
}

async function heicBitmap(file: File): Promise<ImageBitmap> {
  const { heicTo } = await import("heic-to");
  return heicTo({ blob: file, type: "bitmap" });
}

/** 왜 못 열었는지 한 줄로. 영어 원문을 그대로 보이면 무엇을 해야 할지 아무도 모른다. */
function whyFailed(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  if (/heic|heif|libheif/i.test(raw)) return "아이폰 HEIC 사진을 변환하지 못했습니다.";
  if (/decode|decoded/i.test(raw)) return "브라우저가 그림으로 읽지 못하는 파일입니다.";
  return raw;
}

async function toBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // 한 번에 넘기면 인자 수 한도에 걸린다.
  for (let i = 0; i < buffer.length; i += 8192) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * 찍힌 시각. **HEIC 도 그대로 읽힌다**. 실물로 확인했다.
 * 메신저를 거친 사진은 EXIF 가 벗겨져 못 읽는다. 그때는 빈칸으로 둔다.
 */
async function readShotTime(file: File): Promise<{ date: string; time: string; stamp: number }> {
  try {
    const exifr = (await import("exifr")).default;
    const tags = (await exifr.parse(file, ["DateTimeOriginal", "CreateDate"])) as
      | { DateTimeOriginal?: Date; CreateDate?: Date }
      | undefined;
    const shot = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (shot instanceof Date && !Number.isNaN(shot.getTime())) {
      return { date: isoDate(shot), time: hhmm(shot), stamp: shot.getTime() };
    }
  } catch {
    // EXIF 가 없거나 못 읽는 사진도 있다. 그래도 도구는 돌아야 한다.
  }
  return { date: "", time: "", stamp: 0 };
}

function isoDate(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function hhmm(value: Date): string {
  return `${`${value.getHours()}`.padStart(2, "0")}:${`${value.getMinutes()}`.padStart(2, "0")}`;
}
