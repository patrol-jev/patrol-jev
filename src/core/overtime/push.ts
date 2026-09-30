/**
 * 초과기록 진동 알림(웹 푸시). 서버에서만 돈다.
 *
 * 화면이 「알림 켜기」를 누른 기기만 여기에 들어온다. 서버가 받는 것은 **알림 주소와 울릴 시각**뿐이다.
 * 이름, 근무시간, 사유 같은 넣은 값은 오지 않는다. 알림 글은 서버가 칸 번호와 날짜로 **직접 만든다.**
 * 남이 아무 글이나 실어 보내는 통로가 되지 않게 하려는 것이다.
 *
 * 울린 알림은 바로 지운다. 울릴 것이 하나도 안 남은 기기는 주소까지 지운다.
 * 서버가 멈춰 있던 사이 지나간 알림은 늦게 울리지 않고 버린다.
 *
 * 암호는 표준 그대로 node 의 crypto 로 짠다(RFC 8291 aes128gcm, RFC 8292 VAPID).
 * 키는 환경 변수 `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` 에서만 읽는다. 만드는 법은 `scripts/make-vapid.mjs`.
 * 키가 없으면 알림 켜기가 조용히 꺼진다. 나머지 화면은 그대로 돈다.
 */

import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign, type ECDH } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { dayLabel, slotLabel } from "./plan";

export interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type Job = { at: number; kind: "slot"; hour: number } | { at: number; kind: "day"; date: string };

interface Entry {
  subscription: Subscription;
  jobs: Job[];
}

/** 한 기기가 맡길 수 있는 알림 수. 하루 칸 24 + 올릴 날 알림 여럿이면 넉넉하다. */
export const MAX_JOBS = 60;
/** 얼마나 앞까지 맡을지. 며칠 뒤 초과를 미리 넣어 둘 수 있게. */
export const MAX_AHEAD_MS = 8 * 24 * 60 * 60_000;
/** 서버가 멈췄다 켜졌을 때 이만큼 지난 알림은 울리지 않고 버린다. */
export const STALE_MS = 10 * 60_000;
/** 전체 기기 수 천장. 넘으면 새로 받지 않는다. */
const MAX_DEVICES = 20_000;

/** 브라우저가 주는 알림 주소는 이 푸시 서비스들 중 하나다. 다른 곳으로는 보내지 않는다. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
  /^android\.googleapis\.com$/,
];

const b64u = (buf: Buffer) => buf.toString("base64url");
const fromB64u = (text: string) => Buffer.from(text, "base64url");
const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

export function vapidKeys(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  // 푸시 서비스가 연락처로 받는 값. mailto: 나 https: 여야 한다.
  const subject = process.env.VAPID_SUBJECT?.trim() || "https://github.com/patrol-jev/patrol-jev";
  return { publicKey, privateKey, subject };
}

// ── 받는 값 검사 ────────────────────────────────────────────────

const ID = /^[A-Za-z0-9_-]{16,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export function readSubscription(value: unknown): Subscription | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof v.endpoint !== "string" || v.endpoint.length > 1024) return null;
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some((h) => h.test(url.hostname))) return null;
  const p256dh = v.keys?.p256dh;
  const auth = v.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (fromB64u(p256dh).length !== 65 || fromB64u(auth).length !== 16) return null;
  return { endpoint: v.endpoint, keys: { p256dh, auth } };
}

/** 맡길 알림 목록을 읽는다. 틀린 줄은 버리고, 지난 것과 너무 먼 것도 버린다. */
export function readJobs(value: unknown, now: number): Job[] {
  if (!Array.isArray(value)) return [];
  const out: Job[] = [];
  for (const raw of value.slice(0, MAX_JOBS * 2)) {
    if (!raw || typeof raw !== "object") continue;
    const j = raw as { at?: unknown; kind?: unknown; hour?: unknown; date?: unknown };
    if (typeof j.at !== "number" || !Number.isFinite(j.at)) continue;
    if (j.at <= now || j.at > now + MAX_AHEAD_MS) continue;
    if (j.kind === "slot" && Number.isInteger(j.hour) && (j.hour as number) >= 0 && (j.hour as number) < 24) {
      out.push({ at: j.at, kind: "slot", hour: j.hour as number });
    } else if (j.kind === "day" && typeof j.date === "string" && DATE.test(j.date)) {
      out.push({ at: j.at, kind: "day", date: j.date });
    }
    if (out.length >= MAX_JOBS) break;
  }
  return out.sort((a, b) => a.at - b.at);
}

/** 알림 글. 서버가 칸 번호와 날짜로만 만든다. */
export function messageOf(job: Job): { title: string; body: string; tag: string; url: string } {
  if (job.kind === "slot") {
    return {
      title: "초과기록",
      body: `${slotLabel(job.hour)} 칸 [확인]을 누를 때입니다.`,
      tag: `slot-${job.hour}`,
      url: "/overtime",
    };
  }
  return {
    title: "초과기록",
    body: `${dayLabel(job.date)} 초과근무 확인자료를 올릴 차례입니다.`,
    tag: `day-${job.date}`,
    url: "/overtime",
  };
}

// ── 암호(RFC 8291) ─────────────────────────────────────────────

/** 받는 쪽 공개키·인증값으로 알림 몸통을 잠근다. 검사에서 풀어 보려고 보내는 쪽 키와 소금을 받을 수 있게 둔다. */
export function encrypt(
  payload: Buffer,
  subscription: Subscription,
  sender: ECDH = createECDH("prime256v1"),
  salt: Buffer = randomBytes(16),
): Buffer {
  const uaPublic = fromB64u(subscription.keys.p256dh);
  const authSecret = fromB64u(subscription.keys.auth);
  let asPublic: Buffer;
  try {
    asPublic = sender.getPublicKey();
  } catch {
    asPublic = sender.generateKeys();
  }
  const shared = sender.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, sealed]);
}

/** VAPID 머리(RFC 8292). 푸시 서비스가 「이 서버가 보낸 것」을 확인하는 값. */
export function vapidHeader(endpoint: string, keys: { publicKey: string; privateKey: string; subject: string }, now: number): string {
  const head = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: keys.subject })),
  );
  const pub = fromB64u(keys.publicKey);
  const raw = fromB64u(keys.privateKey);
  const d = b64u(Buffer.concat([Buffer.alloc(Math.max(0, 32 - raw.length)), raw]));
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const signature = sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** 한 통 보낸다. 주소가 죽었으면(404·410) "gone". */
async function deliver(subscription: Subscription, job: Job, now: number): Promise<"ok" | "gone" | "fail"> {
  const keys = vapidKeys();
  if (!keys) return "fail";
  const body = encrypt(Buffer.from(JSON.stringify(messageOf(job))), subscription);
  try {
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidHeader(subscription.endpoint, keys, now),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "600",
        Urgency: "high",
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "fail";
  } catch {
    return "fail";
  }
}

// ── 맡은 알림(파일 한 장) ─────────────────────────────────────────

function storePath(): string {
  const set = process.env.OVERTIME_PUSH_FILE?.trim();
  if (set) return set.replace(/^~(?=$|[\\/])/, homedir());
  return join(homedir(), ".patrol-overtime-push.json");
}

interface State {
  entries: Map<string, Entry>;
  loaded: boolean;
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
}

// 개발 서버가 모듈을 다시 읽어도 한 벌만 돌게 전역에 둔다.
const g = globalThis as unknown as { __pjOvertimePush?: State };
const state: State = (g.__pjOvertimePush ??= { entries: new Map(), loaded: false, timer: null, busy: false });

function load() {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf8")) as Record<string, Entry>;
    for (const [id, entry] of Object.entries(raw)) {
      const subscription = readSubscription(entry?.subscription);
      if (isId(id) && subscription && Array.isArray(entry.jobs)) state.entries.set(id, { subscription, jobs: entry.jobs });
    }
  } catch {
    // 파일이 없으면 빈 채로 시작한다.
  }
}

function save() {
  const path = storePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(state.entries)));
    renameSync(tmp, path);
  } catch {
    // 못 적어도 이번 실행 동안은 메모리로 돈다.
  }
}

/** 이 기기의 알림을 통째로 바꿔 넣는다. 목록이 비면 기기째 지운다. */
export function putJobs(id: string, subscription: Subscription, jobs: Job[]): { ok: boolean; count: number } {
  load();
  if (jobs.length === 0) {
    const had = state.entries.delete(id);
    if (had) save();
    return { ok: true, count: 0 };
  }
  if (!state.entries.has(id) && state.entries.size >= MAX_DEVICES) return { ok: false, count: 0 };
  state.entries.set(id, { subscription, jobs });
  save();
  startTicker();
  return { ok: true, count: jobs.length };
}

export function dropDevice(id: string) {
  load();
  if (state.entries.delete(id)) save();
}

/** 때가 된 알림을 보낸다. 보낸 것과 늦은 것은 지운다. */
export async function tick(now: number = Date.now()) {
  load();
  if (state.busy) return;
  state.busy = true;
  let changed = false;
  try {
    for (const [id, entry] of [...state.entries]) {
      const due = entry.jobs.filter((j) => j.at <= now);
      if (due.length === 0) continue;
      entry.jobs = entry.jobs.filter((j) => j.at > now);
      changed = true;
      // 같은 순간에 여럿이 걸렸으면 마지막 것 하나만 울린다. 폰이 연달아 떨지 않게.
      const fresh = due.filter((j) => now - j.at <= STALE_MS);
      const last = fresh[fresh.length - 1];
      if (last && (await deliver(entry.subscription, last, now)) === "gone") entry.jobs = [];
      if (entry.jobs.length === 0) state.entries.delete(id);
    }
  } finally {
    state.busy = false;
    if (changed) save();
  }
}

/** 20초마다 한 번 본다. 서버가 뜰 때(`src/instrumentation.ts`)와 알림을 맡을 때 켜진다. 두 번 켜지지 않는다. */
export function startTicker() {
  if (state.timer || !vapidKeys()) return;
  load();
  state.timer = setInterval(() => void tick(), 20_000);
  state.timer.unref?.();
}
