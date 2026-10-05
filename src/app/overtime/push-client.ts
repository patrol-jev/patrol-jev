/**
 * 초과기록 진동 알림, 브라우저 쪽.
 *
 * 서버로 보내는 것은 기기 번호(여기서 지어낸 무작위 값), 알림 주소, 울릴 시각과 칸 번호·날짜뿐이다.
 * 판단은 하지 않는다. 무엇을 언제 울릴지는 화면이 `src/core/overtime/plan.ts` 로 셈한 값을 그대로 옮긴다.
 *
 * 아이폰 앱 안에서는 웹 푸시가 없다. 대신 앱이 `patrolAlarm` 통로를 열어 두면 같은 목록을 앱에 넘기고,
 * 앱이 기기 안에서 울린다(`ios/Patrol/Alarm/AlarmCenter.swift`). 이때는 서버에 아무것도 맡기지 않는다.
 */

export type PushJob = { at: number; kind: "slot"; hour: number } | { at: number; kind: "day"; date: string };

export type PushReady = "yes" | "no" | "install";

const SW = "/overtime-sw.js";
const SCOPE = "/overtime";
const API = "/api/overtime/push";

type NativeReply = { ok?: boolean; why?: string };
type NativeHandler = { postMessage: (message: unknown) => Promise<NativeReply | undefined> };

/** 앱 안이면 앱이 연 알림 통로. 사파리·다른 브라우저면 null. */
function nativeAlarm(): NativeHandler | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { webkit?: { messageHandlers?: { patrolAlarm?: NativeHandler } } };
  return w.webkit?.messageHandlers?.patrolAlarm ?? null;
}

/** 알림을 앱이 기기 안에서 울리는가(서버에 안 맡기는가). */
export function isNativeAlarm(): boolean {
  return nativeAlarm() !== null;
}

/** 이 기기에서 켤 수 있는가. 아이폰은 홈 화면에 추가한 뒤에만 된다. */
export function pushReady(): PushReady {
  if (typeof window === "undefined") return "no";
  if (nativeAlarm()) return "yes";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "no";
  return "yes";
}

export function newDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const found = await navigator.serviceWorker.getRegistration(SCOPE);
  return found ?? navigator.serviceWorker.register(SW, { scope: SCOPE });
}

/** 권한을 묻고 알림 주소를 받는다. 실패하면 까닭을 글로 돌려준다. */
export async function subscribe(): Promise<{ ok: true; sub: PushSubscription | null } | { ok: false; why: string }> {
  const native = nativeAlarm();
  if (native) {
    const got = await native.postMessage({ op: "enable" }).catch(() => undefined);
    return got?.ok ? { ok: true, sub: null } : { ok: false, why: got?.why || "알림을 켜지 못했습니다." };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, why: "알림 권한이 없습니다. 브라우저 설정에서 이 사이트 알림을 허용해 주세요." };
  const res = await fetch(API);
  const { publicKey } = (await res.json()) as { publicKey: string | null };
  if (!publicKey) return { ok: false, why: "이 서버는 아직 알림을 맡지 않습니다." };
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  if (old) return { ok: true, sub: old };
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  return { ok: true, sub };
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** 이 기기의 알림을 통째로 맞춘다. 빈 목록이면 서버에서 지워진다. */
export async function syncJobs(id: string, jobs: PushJob[]): Promise<boolean> {
  const native = nativeAlarm();
  if (native) {
    const got = await native.postMessage({ op: "sync", jobs }).catch(() => undefined);
    return got?.ok === true;
  }
  const sub = await currentSub();
  if (!sub) return false;
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, subscription: sub.toJSON(), jobs }),
  });
  return res.ok;
}

export async function unsubscribe(id: string): Promise<void> {
  const native = nativeAlarm();
  if (native) {
    await native.postMessage({ op: "off" }).catch(() => undefined);
    return;
  }
  await fetch(API, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => undefined);
  const sub = await currentSub().catch(() => null);
  await sub?.unsubscribe().catch(() => undefined);
}
