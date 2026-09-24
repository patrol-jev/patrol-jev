"use client";
/* eslint-disable @next/next/no-img-element */

import type { PreparedPhoto } from "./photo";

/**
 * 묶음 카드의 섬네일 한 장. **찍힌 시각을 사진 위에 적는다.**
 *
 * 줄 세우기는 시각을 아는 장만 시각으로 하고, 모르는 장은 맨 뒤에 따로 둔다. 그 장은 제 자리에
 * 못 들어가 사람이 합쳐야 할 수 있다. 어느 장이 그런지 스크롤하면서 바로 보이게, 모르는 장은
 * 점선 테두리로 다르게 그린다. 글자는 안 얹는다. 작은 사진 위에
 * 문구까지 얹으면 사진이 가려진다. 무슨 뜻인지는 올린 직후 한 번 뜨는 알림이 말해 준다.
 *
 * 색은 쓰지 않는다. 무지개는 Jev 값, 회색은 생성 모델과 사람의 값이라는 규칙이 있다.
 * 시각은 코드가 읽은 것이라 어느 쪽도 아니다. 먹색과 흰색만 쓴다.
 */
export function Thumb({ photo, onOpen }: { photo: PreparedPhoto; onOpen: () => void }) {
  const unknown = photo.timeFrom === null;
  const label = unknown ? "" : photo.timeFrom === "text" ? `${photo.time} 글자` : photo.time;

  return (
    <button type="button" onClick={onOpen} className="relative shrink-0">
      <img
        src={photo.url}
        alt=""
        className="h-20 w-20 rounded-md object-cover"
        style={{
          background: "var(--wash)",
          outline: unknown ? "2px dashed var(--ink)" : undefined,
          outlineOffset: unknown ? "-2px" : undefined,
        }}
      />
      {label && (
        <span
          className="tnum absolute bottom-1 left-1 rounded px-1 text-[10px] leading-4"
          style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
        >
          {label}
        </span>
      )}
    </button>
  );
}
