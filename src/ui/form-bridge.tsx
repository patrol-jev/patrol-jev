"use client";

import { useState, useSyncExternalStore } from "react";
import type { FormMap } from "@/core/form-map";
import type { PeriodFormMap } from "@/core/period-form-map";
import { SLOT_LABELS, type SlotKey } from "@/core/form-slots";
import { fillForm } from "@/core/hwpx/fill";
import type { IljiSlots } from "@/core/ilji-slots";
import { downloadBytes } from "@/ui/hwpx-photo";

/**
 * 부서 양식으로 받기.
 *
 * 양식 hwpx 를 한 번 올리면 서버가 **칸 지도**(어느 셀이 어느 자리인가)를 돌려준다. 파일은 서버에
 * 남지 않는다. 그 뒤로는 이 브라우저가 양식과 지도를 기억하고 있다가, 회차마다 글과 사진을
 * 그 자리에 채워 내려준다. 채우기는 브라우저 안에서 끝나고 사진은 서버로 안 간다.
 *
 * 못 이은 자리는 이름으로 알린다. 그 란은 위의 글에서 복사해 붙이면 된다.
 *
 * 양식은 둘이다. 일지 양식(하루치 · 주간)과 결과 보고서 양식(기간). 따로 올리고 따로 기억한다.
 */

const STORAGE = "patrol.form.v1";
const PERIOD_STORAGE = "patrol.form.period.v1";

interface Kept {
  name: string;
  /** hwpx 바이트, base64. */
  data: string;
  map: FormMap;
}

interface KeptPeriod {
  name: string;
  data: string;
  map: PeriodFormMap;
}

function readKeptPeriod(): KeptPeriod | null {
  try {
    const raw = localStorage.getItem(PERIOD_STORAGE);
    return raw ? (JSON.parse(raw) as KeptPeriod) : null;
  } catch {
    return null;
  }
}

function writeKeptPeriod(kept: KeptPeriod | null): void {
  try {
    if (kept) localStorage.setItem(PERIOD_STORAGE, JSON.stringify(kept));
    else localStorage.removeItem(PERIOD_STORAGE);
  } catch {
    // 못 기억해도 이번 회차는 된다. 다음에 다시 올리면 된다.
  }
}

/** 기억해 둔 결과 보고서 양식. 기간 보고서가 이 양식으로 나가려고 본다. 없으면 null. */
export function keptPeriodForm(): { name: string; bytes: Uint8Array; map: PeriodFormMap } | null {
  const kept = readKeptPeriod();
  return kept ? { name: kept.name, bytes: fromBase64(kept.data), map: kept.map } : null;
}

function readKept(): Kept | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? (JSON.parse(raw) as Kept) : null;
  } catch {
    return null;
  }
}

/** 기억해 둔 부서 양식. 주간 일지가 같은 양식으로 나가려고 본다. 없으면 null. */
export function keptForm(): { name: string; bytes: Uint8Array; map: FormMap } | null {
  const kept = readKept();
  return kept ? { name: kept.name, bytes: fromBase64(kept.data), map: kept.map } : null;
}

function writeKept(kept: Kept | null): void {
  try {
    if (kept) localStorage.setItem(STORAGE, JSON.stringify(kept));
    else localStorage.removeItem(STORAGE);
  } catch {
    // 못 기억해도 이번 회차는 된다. 다음에 다시 올리면 된다.
  }
}

function subscribeNothing(): () => void {
  return () => undefined;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const GRADE_NOTE: Record<FormMap["grade"], string> = {
  A: "글 칸과 사진 칸을 다 찾았습니다. 이 양식 그대로 나옵니다.",
  B: "글 칸은 찾았는데 사진 칸을 못 찾았습니다. 글만 채우고 사진은 기본 양식 파일에서 가져오세요.",
  C: "이 양식은 아직 잘 못 잇습니다. 채운 것만 채워 드리고, 나머지는 위의 글을 붙여 주세요.",
};

/** 양식 파일을 서버에 보내 칸 지도를 받는다. 파일은 서버에 남지 않는다. */
async function mapOf<M>(file: File, kind: "ilji" | "period"): Promise<M> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(kind === "period" ? "/api/form/map?kind=period" : "/api/form/map", { method: "POST", body });
  const json = (await response.json()) as { map?: M; error?: string };
  if (!response.ok || !json.map) throw new Error(json.error ?? "칸 지도를 만들지 못했습니다.");
  return json.map;
}

/** 기억한 양식에 지금 일지를 채워 내려준다. 돌려주는 글은 화면에 적을 한 줄이다. */
async function fillWith(kept: Kept, collect: (ratio: number) => Promise<IljiSlots>, date: string): Promise<string> {
  const slots = await collect(kept.map.photoRatio || 1.25);
  const result = fillForm(fromBase64(kept.data), kept.map, slots);
  const stem = kept.name.replace(/\.hwpx?$/i, "");
  downloadBytes(result.bytes, `${stem} ${date}.hwpx`);
  const left = result.skipped.map((k) => SLOT_LABELS[k]);
  const notes: string[] = [`내려받았습니다. 사진 ${result.photosPlaced}장을 넣었습니다.`];
  if (left.length > 0) notes.push(`못 채운 란: ${left.join(", ")}. 위의 글에서 복사해 붙여 주세요.`);
  // 양식의 사진 칸보다 자리가 많으면 뒤의 자리는 조용히 빠진다. 그걸 조용히 두지 않는다.
  if (result.photosOffered > result.photoSlots) {
    notes.push(`이 양식은 사진 자리가 ${result.photoSlots}곳이라 ${result.photosOffered}자리 가운데 앞의 ${result.photoSlots}자리만 실었습니다. 나머지는 기본 양식 파일에서 가져오세요.`);
  }
  return notes.join(" ");
}

/**
 * 뽑기에서 「부서 양식」을 골랐을 때 결과 카드가 부른다. 기억한 양식이 없으면 null(기본 양식으로 가라는 뜻).
 * 보고서 탭의 단추와 같은 코드다.
 */
export async function fillKeptForm(collect: (ratio: number) => Promise<IljiSlots>, date: string): Promise<string | null> {
  const kept = readKept();
  return kept ? fillWith(kept, collect, date) : null;
}

/**
 * 결과 카드 · 보고서 카드에서 바로 양식을 올릴 때. 칸 지도를 받아 이 브라우저에 기억하고 파일 이름을 돌려준다.
 * 보고서 탭의 「양식 올리기」와 같은 길이다. 양식을 올리러 탭을 찾아가지 않게 그 자리에서 올린다.
 */
export async function keepUploadedForm(file: File, kind: "ilji" | "period"): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === "period") {
    const map = await mapOf<PeriodFormMap>(file, "period");
    writeKeptPeriod({ name: file.name, data: toBase64(bytes), map });
  } else {
    const map = await mapOf<FormMap>(file, "ilji");
    writeKept({ name: file.name, data: toBase64(bytes), map });
  }
  return file.name;
}

export function FormBridge({
  collect,
  date,
  onFilled,
}: {
  /** 지금 화면의 일지를 자리로 모은다(사진 포함). 기본 양식 파일과 같은 값이다. 비율은 사진 칸의 가로/세로. */
  collect: (ratio: number) => Promise<IljiSlots>;
  date: string;
  /** 부서 양식 파일을 내려받았거나 양식을 올리고 지웠을 때. 밖의 화면이 양식 이름을 다시 읽게. */
  onFilled?: () => void;
}) {
  // localStorage 는 서버에 없다. 브라우저에 붙은 뒤에만 읽는다.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [picked, setPicked] = useState<Kept | null | undefined>(undefined);
  const kept = picked !== undefined ? picked : mounted ? readKept() : null;
  const [pickedPeriod, setPickedPeriod] = useState<KeptPeriod | null | undefined>(undefined);
  const period = pickedPeriod !== undefined ? pickedPeriod : mounted ? readKeptPeriod() : null;
  const [busy, setBusy] = useState<"map" | "period" | "fill" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy("map");
    setNote(null);
    try {
      const map = await mapOf<FormMap>(file, "ilji");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const next: Kept = { name: file.name, data: toBase64(bytes), map };
      setPicked(next);
      writeKept(next);
      onFilled?.();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "양식을 읽지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function uploadPeriod(file: File) {
    setBusy("period");
    setNote(null);
    try {
      const map = await mapOf<PeriodFormMap>(file, "period");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const next: KeptPeriod = { name: file.name, data: toBase64(bytes), map };
      setPickedPeriod(next);
      writeKeptPeriod(next);
      onFilled?.();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "결과 보고서 양식을 읽지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function fill() {
    if (!kept) return;
    setBusy("fill");
    setNote(null);
    try {
      setNote(await fillWith(kept, collect, date));
      onFilled?.();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "채우지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  const map = kept?.map ?? null;
  const total = Object.keys(SLOT_LABELS).length;
  const linked = map ? Object.keys(map.text).length : 0;
  const unlinked: SlotKey[] = map ? [...map.missing, ...map.ambiguous] : [];

  return (
    <section className="rounded-xl p-3" style={{ background: "var(--paper)", border: "1px solid var(--line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">부서 양식으로 받기</p>
          <p className="text-[11px] text-[var(--muted)]">본인 동 양식(.hwpx)을 올리면 그 양식 그대로 나옵니다. 파일은 이 브라우저에만 남습니다.</p>
        </div>
        <label
          className="cursor-pointer rounded-md px-3 py-1.5 text-[12px]"
          style={{ border: "1px solid var(--line)", color: "var(--ink)", opacity: busy ? 0.6 : 1 }}
        >
          {busy === "map" ? "읽는 중" : kept ? "다른 양식 올리기" : "양식 올리기"}
          <input
            type="file"
            accept=".hwpx"
            className="hidden"
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
        {kept && (
          <button
            onClick={fill}
            disabled={busy !== null}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium"
            style={{ background: "var(--ink)", color: "var(--paper)", opacity: busy ? 0.6 : 1 }}
          >
            {/* 글자만 Jev 빛. 보고서 탭에서 산출로 가는 첫 단추가 이것이라 기본 양식 대신 여기 칠한다. */}
            <span className="iri-text">{busy === "fill" ? "채우는 중" : "부서 양식(.hwpx)"}</span>
          </button>
        )}
      </div>

      {map && kept && (
        <div className="mt-2 space-y-1 text-[11.5px]">
          <p>
            <span className="font-medium">{kept.name}</span>
            <span className="text-[var(--muted)]">
              {" "}
              · 등급 {map.grade} · 이은 칸 {linked}/{total} · 사진 자리 {map.photos.length}
              {map.photos.some((p) => p.cells.length >= 2) ? "(전·후)" : ""}
            </span>
          </p>
          <p className="text-[var(--muted)]">{GRADE_NOTE[map.grade]}</p>
          {unlinked.length > 0 && (
            <p className="text-[var(--muted)]">못 이은 란: {unlinked.map((k) => SLOT_LABELS[k]).join(", ")}</p>
          )}
          {map.prefilled.length > 0 && (
            <p className="text-[var(--muted)]">
              이미 글이 들어 있는 칸이 있습니다({map.prefilled.map((k) => SLOT_LABELS[k]).join(", ")}). 채우면 그 글은 지워집니다.
              빈 양식을 올리는 것이 맞습니다.
            </p>
          )}
          <p>
            <button
              onClick={() => {
                setPicked(null);
                writeKept(null);
                setNote(null);
                onFilled?.();
              }}
              className="text-[11px] text-[var(--muted)] underline underline-offset-2"
            >
              양식 지우기
            </button>
          </p>
        </div>
      )}

      {/* 결과 보고서 양식. 기간 보고서(주 · 달)가 이 양식으로 나간다. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5" style={{ borderColor: "var(--line)" }}>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium">결과 보고서 양식</p>
          <p className="text-[11px] text-[var(--muted)]">
            {period
              ? `${period.name}${period.map.missing.length > 0 ? ` · 못 찾은 표: ${period.map.missing.join(", ")}` : " · 표를 다 찾았습니다"}`
              : "결과 보고서 양식(.hwpx)도 올려 두면 기간 보고서가 그 양식 그대로 나옵니다."}
          </p>
        </div>
        <label
          className="cursor-pointer rounded-md px-3 py-1.5 text-[12px]"
          style={{ border: "1px solid var(--line)", color: "var(--ink)", opacity: busy ? 0.6 : 1 }}
        >
          {busy === "period" ? "읽는 중" : period ? "다른 양식 올리기" : "양식 올리기"}
          <input
            type="file"
            accept=".hwpx"
            className="hidden"
            disabled={busy !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadPeriod(file);
            }}
          />
        </label>
        {period && (
          <button
            onClick={() => {
              setPickedPeriod(null);
              writeKeptPeriod(null);
              onFilled?.();
            }}
            className="text-[11px] text-[var(--muted)] underline underline-offset-2"
          >
            지우기
          </button>
        )}
      </div>

      {note && <p className="mt-2 text-[11.5px]">{note}</p>}
    </section>
  );
}
