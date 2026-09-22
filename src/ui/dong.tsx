"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 「우리 동」 고르기.
 *
 * 고른 동의 도로명으로 주소판에서 읽은 글자를 대조한다. 담당자가 자기 동을 한 번 고르면
 * 이 브라우저는 그대로 기억한다. 색인을 안 만들었으면 만드는 법을 알려 준다.
 *
 * 서울만 해도 동이 446개다. 목록을 훑어 내리는 것보다 **쳐서 좁히는 쪽**이 빠르다 —
 * 두 자만 쳐도 한 줄로 줄어든다. 그래서 입력칸이고, 밑에 걸리는 것만 띄운다.
 *
 * 여기에는 지명이 하나도 박혀 있지 않다 — 목록은 전부 도로명주소 색인에서 온다.
 */

export interface DongChoice {
  name: string;
  sigungu: string;
  dong: string;
  roads: number;
  buildings: number;
}

/** 한 번에 띄우는 줄 수. 더 있으면 더 치라고 알려 준다. */
const SHOWN = 8;

export function DongPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (name: string | null, choice: DongChoice | null) => void;
  disabled?: boolean;
}) {
  const [dongs, setDongs] = useState<DongChoice[] | null>(null);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/dongs")
      .then((response) => (response.ok ? response.json() : { dongs: [] }))
      .then((body: { dongs?: DongChoice[] }) => {
        if (alive) setDongs(Array.isArray(body.dongs) ? body.dongs : []);
      })
      .catch(() => {
        if (alive) setDongs([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 바깥을 누르면 닫는다. 고르지 않고 딴 데로 갈 수 있어야 한다.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const chosen = (dongs ?? []).find((d) => d.name === value) ?? null;

  const hits = useMemo(() => {
    const words = typed.trim().split(/\s+/).filter(Boolean);
    const all = dongs ?? [];
    if (words.length === 0) return all.slice(0, SHOWN);

    // 친 낱말이 구 이름에 있든 동 이름에 있든 걸리게. 구와 동을 같이 쳐도 찾아진다.
    const matched = all.filter((choice) =>
      words.every((word) => choice.sigungu.includes(word) || choice.dong.includes(word)),
    );
    return matched;
  }, [dongs, typed]);

  if (dongs === null) {
    return <p className="text-[11.5px] text-[var(--muted)]">동 목록을 읽는 중…</p>;
  }

  if (dongs.length === 0) {
    return (
      <p className="text-[11.5px] text-[var(--muted)]">
        도로명 색인이 없습니다. 주소판에서 읽은 글자를 그대로 씁니다. 대조를 켜려면{" "}
        <b className="text-[var(--ink)]">도로명주소 한글</b> 파일을 <code>road/</code> 에 두고{" "}
        <code>npm run roads:build</code> 를 한 번 돌리세요.
      </p>
    );
  }

  const pick = (choice: DongChoice | null) => {
    onChange(choice?.name ?? null, choice);
    setTyped("");
    setOpen(false);
  };

  return (
    <div ref={box} className="relative flex flex-wrap items-center gap-2">
      <label className="text-[11.5px] text-[var(--muted)]" htmlFor="dong">
        우리 동
      </label>

      <input
        id="dong"
        value={open ? typed : chosen ? `${chosen.sigungu} ${chosen.dong}` : ""}
        disabled={disabled}
        placeholder="동 이름을 치세요 (예: 우리 동 이름 두 자)"
        autoComplete="off"
        onFocus={() => {
          setTyped("");
          setOpen(true);
        }}
        onChange={(event) => {
          setTyped(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && hits.length === 1) {
            event.preventDefault();
            pick(hits[0]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className="min-w-0 flex-1 rounded-md px-2 py-1 text-[12px] sm:max-w-56"
        style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" }}
      />

      {chosen && !open && (
        <>
          <span className="text-[11px] text-[var(--muted)]">
            도로 {chosen.roads}개 · 건물 {chosen.buildings.toLocaleString()}건으로 주소를 대조합니다.
          </span>
          <button
            type="button"
            onClick={() => pick(null)}
            className="rounded px-1.5 py-0.5 text-[11px]"
            style={{ background: "var(--wash)", color: "var(--muted)", border: "1px solid var(--line)" }}
          >
            지움
          </button>
        </>
      )}

      {open && (
        <ul
          className="absolute left-0 top-full z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg py-1 sm:w-72"
          style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
        >
          {hits.length === 0 && (
            <li className="px-3 py-2 text-[11.5px] text-[var(--muted)]">
              걸리는 동이 없습니다. 색인에 담긴 시·도만 고를 수 있습니다.
            </li>
          )}

          {hits.slice(0, SHOWN).map((choice) => (
            <li key={choice.name}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(choice)}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12px] hover:opacity-80"
                style={{ color: "var(--ink)" }}
              >
                <span>{choice.dong}</span>
                <span className="text-[11px] text-[var(--muted)]">{choice.sigungu}</span>
                <span className="ml-auto text-[10.5px] text-[var(--muted)]">도로 {choice.roads}</span>
              </button>
            </li>
          ))}

          {hits.length > SHOWN && (
            <li className="px-3 py-1.5 text-[11px] text-[var(--muted)]">
              {hits.length - SHOWN}개 더 있습니다. 조금 더 치세요.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
