/**
 * 초과기록 회귀 검사. 사용 안내와 규정 제15조에 적힌 사례를 그대로 넣어 본다.
 * 진동 알림(서버 쪽)은 지어낸 키와 임시 파일로 돈다. 실제 푸시 서비스로는 아무것도 나가지 않는다(fetch 를 가로챈다).
 *
 *   node --experimental-strip-types --import ./scripts/ts-hooks.mjs scripts/check-overtime.mjs
 */

import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dayLabel, isRecordHour, isWeekend, kstAt, kstToday, nextDate, nudgeAt, parseHhmm, planDay, readTyped } from "../src/core/overtime/plan.ts";
import { FAQ, SOURCES } from "../src/core/overtime/faq.ts";
import { applyEvents, jobsOf, readEvents, segmentsOf } from "../src/core/overtime/alarms.ts";

const vapid = createECDH("prime256v1");
vapid.generateKeys();
process.env.VAPID_PUBLIC_KEY = vapid.getPublicKey().toString("base64url");
process.env.VAPID_PRIVATE_KEY = vapid.getPrivateKey().toString("base64url");
process.env.OVERTIME_PUSH_FILE = join(mkdtempSync(join(tmpdir(), "pj-ot-")), "push.json");
const push = await import("../src/core/overtime/push.ts");

const problems = [];
let checked = 0;
function check(name, condition, detail = "") {
  checked++;
  if (condition) console.log(`OK   ${name}`);
  else problems.push(`${name}${detail ? ` : ${detail}` : ""}`);
}

const t = (s) => parseHhmm(s);
const r = (a, b) => ({ from: t(a), to: t(b) });
const day = (over = {}) => ({ holiday: false, base: r("09:00", "18:00"), spans: [], gaps: [], ...over });
const hours = (plan) => plan.slots.map((s) => s.hour).join(",");
const acts = (plan) => plan.slots.map((s) => `${s.hour}${s.action === "click" ? "C" : "R"}`).join(",");

// ① 18:00~20:40 = 세 칸(사용 안내)
const q7 = planDay(day({ spans: [r("18:00", "20:40")] }));
check("18:00~20:40 은 18·19·20 세 칸", hours(q7) === "18,19,20", hours(q7));
check("세 칸 모두 [확인]", q7.slots.every((s) => s.action === "click"));
check("초과 160분", q7.overtimeMinutes === 160, String(q7.overtimeMinutes));

// ② 끝이 정각이면 그 칸은 없다. 19:00 정각 시작은 19~20 칸(사용 안내)
const on = planDay(day({ spans: [r("19:00", "21:00")] }));
check("19:00~21:00 은 19·20 두 칸", hours(on) === "19,20", hours(on));
const midnight = planDay(day({ spans: [r("21:00", "24:00")] }));
check("21:00~24:00 은 21·22·23 세 칸", hours(midnight) === "21,22,23", hours(midnight));

// ③ 18~19 식사 · 19~20 근무 · 20~21 외출(사용 안내)
const mix = planDay(
  day({
    spans: [r("18:00", "21:00")],
    gaps: [
      { kind: "meal", ...r("18:00", "19:00") },
      { kind: "away", ...r("20:00", "21:00") },
    ],
  }),
);
check("식사·근무·외출 = 사유·확인·사유", acts(mix) === "18R,19C,20R", acts(mix));
check("식사 칸 사유는 저녁 식사", mix.slots[0].reason === "저녁 식사", mix.slots[0].reason);
check("외출 칸 사유는 개인용무(외출)", mix.slots[2].reason === "개인용무(외출)", mix.slots[2].reason);
check("근무제외시간은 외출 20~21 만", mix.exclusions.length === 1 && mix.exclusions[0].from === t("20:00") && mix.exclusions[0].to === t("21:00"));

// ④ 식사가 칸 일부만 덮으면 남은 틈에 누른다
const part = planDay(day({ spans: [r("18:00", "20:00")], gaps: [{ kind: "meal", ...r("18:20", "19:10") }] }));
check("식사 18:20~19:10 이면 두 칸 모두 [확인]", acts(part) === "18C,19C", acts(part));
check("18시 칸 틈은 18:00~18:20", part.slots[0].windows[0].from === t("18:00") && part.slots[0].windows[0].to === t("18:20"));

// ⑤ 유연근무(사용 안내): 10~19 근무면 09~10 은 기록 칸, 18~19 는 아님
const flex = { holiday: false, base: r("10:00", "19:00") };
check("10~19 근무: 9시 칸은 기록 칸", isRecordHour(9, flex));
check("10~19 근무: 18시 칸은 아님", !isRecordHour(18, flex));
const half = { holiday: false, base: r("09:30", "18:30") };
check("09:30~18:30 근무: 9시 칸도 기록 칸", isRecordHour(9, half));
check("09:30~18:30 근무: 18시 칸도 기록 칸", isRecordHour(18, half));
check("09:30~18:30 근무: 12시 칸은 아님", !isRecordHour(12, half));

// ⑥ 정규 근무시간 안쪽 초과는 뺀다
const inside = planDay(day({ spans: [r("17:00", "19:00")] }));
check("17:00~19:00 은 18시 칸만", hours(inside) === "18", hours(inside));
check("안쪽을 뺐다고 알린다", inside.warnings.some((w) => w.includes("정규 근무시간")));

// ⑦ 아침 초과. 06:00 부터도 된다. 07:57 시작이면 07시 칸 틈이 3분(사용 안내: 놓치면 사유)
const dawn = planDay(day({ spans: [r("06:00", "09:00")] }));
check("06:00~09:00 은 6·7·8 세 칸", hours(dawn) === "6,7,8", hours(dawn));
const early = planDay(day({ spans: [r("07:57", "09:00")] }));
check("07:57~09:00 은 7·8 두 칸", hours(early) === "7,8", hours(early));
check("틈이 짧다고 알린다", early.slots[0].notes.some((n) => n.includes("3분")));

// ⑧ 휴일은 낮 칸도 기록 칸
const hol = planDay({ holiday: true, base: r("09:00", "18:00"), spans: [r("09:00", "13:00")], gaps: [{ kind: "meal", ...r("12:00", "13:00") }] });
check("휴일 09~13 은 네 칸", hours(hol) === "9,10,11,12", hours(hol));
check("휴일 12시 칸은 점심 식사 사유", hol.slots[3].reason === "점심 식사", hol.slots[3].reason);

// ⑨ 현장근무 칸
const field = planDay(day({ spans: [r("18:00", "20:00")], gaps: [{ kind: "field", ...r("18:00", "20:00") }] }));
check("현장 두 칸 = 사유 둘", acts(field) === "18R,19R", acts(field));
check("현장은 제외시간 없음", field.exclusions.length === 0);

// ⑩ 식사 1시간 넘으면 알린다
const long = planDay(day({ spans: [r("18:00", "21:00")], gaps: [{ kind: "meal", ...r("18:00", "20:00") }] }));
check("식사 2시간이면 경고", long.warnings.some((w) => w.includes("1시간을 뺍니다")));
const short = planDay(day({ spans: [r("18:00", "18:40")] }));
check("초과 1시간 미만이면 월 셈에 안 더한다고 알린다(제15조제5항)", short.warnings.some((w) => w.includes("1시간이 안 되면")));
check("1시간 넘으면 그 알림은 없다", !q7.warnings.some((w) => w.includes("1시간이 안 되면")));
const holLong = planDay({ holiday: true, base: r("09:00", "18:00"), spans: [r("09:00", "15:00")], gaps: [{ kind: "meal", ...r("12:00", "14:00") }] });
check("휴일은 1시간 공제 경고를 내지 않는다(지침: 휴일 공제 없음)", !holLong.warnings.some((w) => w.includes("1시간을 뺍니다")));

// ⑪ 알림 시각과 날짜
check("[확인] 알림은 매시 30분", nudgeAt(q7.slots[0]) === t("18:30"));
check("30분에 자리에 없으면 틈 가운데", nudgeAt(part.slots[0]) === t("18:10"), String(nudgeAt(part.slots[0])));
check("18:30 KST = 09:30Z", new Date(kstAt("2026-10-05", t("18:30"))).toISOString() === "2026-10-05T09:30:00.000Z");
check("07:30 KST = 전날 22:30Z", new Date(kstAt("2026-10-05", t("07:30"))).toISOString() === "2026-10-04T22:30:00.000Z");
check("다음 날", nextDate("2026-10-31") === "2026-11-01" && nextDate("2026-12-31") === "2027-01-01");
check(
  "한국 날짜는 UTC 15시에 넘어간다",
  kstToday(Date.UTC(2026, 9, 1, 15, 0)) === "2026-10-02" && kstToday(Date.UTC(2026, 9, 1, 14, 59)) === "2026-10-01",
);
check("날 이름", dayLabel("2026-10-01") === "10/1(목)", dayLabel("2026-10-01"));
check("2026-10-03 은 토요일", isWeekend("2026-10-03"));
check("2026-10-05 는 평일", !isWeekend("2026-10-05"));

// ⑪-2 친 시각 읽기(24시간 꼴)
const typed = { "18": "18:00", "6": "06:00", "930": "09:30", "1830": "18:30", "18:30": "18:30", "18.30": "18:30", "0600": "06:00", "24": "24:00", "2400": "24:00" };
for (const [raw, want] of Object.entries(typed)) check(`「${raw}」 → ${want}`, readTyped(raw) === want, String(readTyped(raw)));
check("못 읽는 것은 null", ["25", "1860", "24:30", "오후6시", "", "12345"].every((x) => readTyped(x) === null));

// ⑫ 진동 알림(서버 쪽). 지어낸 기기 하나로 암호·서명·받는 값 검사·보내기·지우기를 본다.
const ua = createECDH("prime256v1");
ua.generateKeys();
const authSecret = Buffer.from("0123456789abcdef");
const sub = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") },
};

// 받는 쪽처럼 풀어 본다(RFC 8291).
function open(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const sealed = body.subarray(21 + idlen);
  const h = (k, d) => createHmac("sha256", k).update(d).digest();
  const shared = ua.computeSecret(asPublic);
  const ikm = h(h(authSecret, shared), Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = h(salt, ikm);
  const cek = h(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = h(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}
check("알림 몸통을 받는 쪽 키로 풀 수 있다", open(push.encrypt(Buffer.from('{"title":"초과기록"}'), sub)) === '{"title":"초과기록"}');

const header = push.vapidHeader(sub.endpoint, push.vapidKeys(), Date.UTC(2026, 9, 1));
const jwt = /t=([^,]+)/.exec(header)[1].split(".");
const claims = JSON.parse(Buffer.from(jwt[1], "base64url").toString());
const pub = vapid.getPublicKey();
const jwk = { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33, 65).toString("base64url") };
check(
  "VAPID 서명이 공개키로 맞는다",
  verify(
    "sha256",
    Buffer.from(`${jwt[0]}.${jwt[1]}`),
    { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(jwt[2], "base64url"),
  ),
);
check("VAPID 대상은 푸시 서비스 주소", claims.aud === "https://fcm.googleapis.com");

check("알 수 없는 푸시 주소는 받지 않는다", push.readSubscription({ ...sub, endpoint: "https://evil.example.com/x" }) === null);
check("http 주소는 받지 않는다", push.readSubscription({ ...sub, endpoint: "http://fcm.googleapis.com/x" }) === null);
check("애플 푸시 주소는 받는다", push.readSubscription({ ...sub, endpoint: "https://web.push.apple.com/abc" }) !== null);
const now0 = Date.UTC(2026, 9, 1, 9, 0);
const jobs = push.readJobs(
  [
    { at: now0 + 60_000, kind: "slot", hour: 18 },
    { at: now0 - 1, kind: "slot", hour: 18 },
    { at: now0 + 60_000, kind: "slot", hour: 24 },
    { at: now0 + 60_000, kind: "day", date: "2026/10/01" },
    { at: now0 + 60_000, kind: "note", text: "아무 글" },
    { at: now0 + 120_000, kind: "day", date: "2026-10-01" },
  ],
  now0,
);
check("받는 알림은 칸 번호와 날짜뿐, 틀린 줄은 버린다", jobs.length === 2 && jobs[0].kind === "slot" && jobs[1].kind === "day", JSON.stringify(jobs));
check("알림 글은 서버가 만든다", push.messageOf({ at: 0, kind: "slot", hour: 19 }).body === "19~20시 칸 [확인]을 누를 때입니다.");
check("기기 번호 모양", push.isId("abcdefghijklmnop") && !push.isId("짧다") && !push.isId("a/b".repeat(10)));

const stored = () => Object.keys(JSON.parse(readFileSync(process.env.OVERTIME_PUSH_FILE, "utf8")));
const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url, headers: init.headers, body: Buffer.from(init.body) });
  return new Response(null, { status: 201 });
};
push.putJobs("device-aaaaaaaaaaaa", sub, [
  { at: now0 + 60_000, kind: "slot", hour: 18 },
  { at: now0 + 3_600_000, kind: "slot", hour: 19 },
]);
await push.tick(now0 + 30_000);
check("때가 안 된 알림은 보내지 않는다", sent.length === 0);
await push.tick(now0 + 61_000);
check("때가 된 알림을 한 통 보낸다", sent.length === 1 && sent[0].url === sub.endpoint);
check("보낸 몸통을 풀면 서버가 만든 글", JSON.parse(open(sent[0].body)).body === "18~19시 칸 [확인]을 누를 때입니다.");
check("aes128gcm 머리", sent[0].headers["Content-Encoding"] === "aes128gcm" && sent[0].headers.Authorization.startsWith("vapid t="));
await push.tick(now0 + 3_600_000 + 20 * 60_000);
check("서버가 멈춰 늦은 알림은 울리지 않는다", sent.length === 1);
check("울릴 것이 없는 기기는 주소까지 지운다", stored().length === 0, JSON.stringify(stored()));

globalThis.fetch = async () => new Response(null, { status: 410 });
push.putJobs("device-bbbbbbbbbbbb", sub, [
  { at: now0 + 60_000, kind: "slot", hour: 18 },
  { at: now0 + 3_600_000, kind: "slot", hour: 19 },
]);
await push.tick(now0 + 61_000);
check("죽은 주소(410)는 남은 알림째 지운다", stored().length === 0);
push.putJobs("device-cccccccccccc", sub, [{ at: now0 + 60_000, kind: "slot", hour: 18 }]);
push.dropDevice("device-cccccccccccc");
check("알림 끄기는 기기째 지운다", stored().length === 0);

// ⑬ 근거 표기
check("근거 세 층", SOURCES.law.title.includes("제36431호") && SOURCES.guide.title.includes("제377호") && SOURCES.usage.date === "2026-09");
check("법령·지침 답은 조문이나 쪽을 단다", FAQ.every((f) => f.from === "사용 안내" || f.ref.length > 0));
check("사용 안내 답은 내부 자료 자리를 드러내지 않는다", FAQ.every((f) => f.from !== "사용 안내" || f.ref === ""));
check("시간 셈은 법령에서 온다", FAQ.filter((f) => f.group === "시간 셈").every((f) => f.from === "법령"));
check(
  "공개 페이지에 싣지 않는 것(보안 세부·감시 방식·예정 발언)",
  FAQ.every((f) => !/IP|보안정책|60분|개선 예정|검토하겠|반영 전|총량/.test(f.q + f.a)),
);
check("원본에 없는 몰아 신청 이야기는 싣지 않는다", FAQ.every((f) => !f.q.includes("몰아") && !f.a.includes("몰아")));

// ⑭ 공개 문구 규칙: 긴 줄표 없음
const texts = FAQ.flatMap((f) => [f.q, f.a]).concat(mix.slots.map((s) => s.reason ?? ""), long.warnings, inside.warnings);
check("문구에 긴 줄표 없음", texts.every((s) => !s.includes(String.fromCharCode(0x2014))));

// ⑮ 알림 목록(alarms.ts): 토막 · 묻기 · 칸 · 요약 · 다음 날, 그리고 알림 단추의 답
const noteFrom = (plan, holiday = false) => ({
  clicks: plan.slots.flatMap((s) => (nudgeAt(s) === null ? [] : [{ hour: s.hour, at: nudgeAt(s) }])),
  reasons: plan.slots.flatMap((s) => (s.reason ? [{ hour: s.hour, reason: s.reason }] : [])),
  exclusions: plan.exclusions,
  done: false,
  holiday,
});
const D = "2026-10-07";
const dawnEve = noteFrom(planDay(day({ spans: [r("06:00", "21:00")], gaps: [{ kind: "meal", ...r("18:00", "19:00") }] })));
const midnight0 = kstAt(D, 0);
const clock = (job) => {
  const m = Math.round((job.at - midnight0) / 60_000);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const list = (days, now = midnight0) => jobsOf(days, now).map((j) => `${j.kind}${j.hour ?? ""}@${j.kind === "day" ? j.date : clock(j)}`);

const segs = segmentsOf(dawnEve);
check("06~21 신청은 출근 전·퇴근 뒤 두 토막", segs.length === 2 && segs[0].first === 6 && segs[0].until === 9 && segs[1].first === 18 && segs[1].until === 21, JSON.stringify(segs));
const base0 = list({ [D]: dawnEve });
check(
  "묻기는 토막 10분 전, 칸은 권장 시각, 요약은 끝나고 10분 뒤, 다음 날 09:10",
  base0.join(",") === "ask6@05:50,slot6@06:30,slot7@07:30,slot8@08:30,ask18@17:50,slot19@19:30,slot20@20:30,sum@21:10,day@2026-10-07",
  base0.join(","),
);
check("식사로 비운 18시 칸은 알림 없음(사유 칸)", !base0.includes("slot18@18:30"));
const sum0 = jobsOf({ [D]: dawnEve }, midnight0).find((j) => j.kind === "sum");
check("요약은 [확인] 칸 수와 사유 칸 수를 싣는다", sum0.clicks === 5 && sum0.reasons === 1 && sum0.pressed.length === 0, JSON.stringify(sum0));

const hol0 = list({ [D]: { ...dawnEve, holiday: true } });
check("휴일 첫 토막은 30분 전에 묻는다", hol0[0] === "ask6@05:30" && hol0.includes("ask18@17:50"), hol0.join(","));

const left0 = list({ [D]: { ...dawnEve, left: [18] } });
check("「안 남아요」 한 토막은 묻기·칸이 없고 요약은 남은 토막 끝에", !left0.some((j) => /ask18|slot19|slot20/.test(j)) && left0.includes("sum@09:10"), left0.join(","));
const leftAll = list({ [D]: { ...dawnEve, left: [6, 18] } });
check("두 토막 다 안 남으면 요약도 없고 다음 날만", leftAll.join(",") === "day@2026-10-07", leftAll.join(","));

const pressed0 = jobsOf({ [D]: { ...dawnEve, pressed: [19] } }, midnight0);
check("「눌렀어요」 한 칸은 다시 울리지 않는다", !pressed0.some((j) => j.kind === "slot" && j.hour === 19));
check("요약에 눌렀다고 한 칸이 실린다", pressed0.find((j) => j.kind === "sum").pressed.join() === "19");

const ended0 = list({ [D]: { ...dawnEve, endedAt: 19 * 60 + 5 } });
check("「끝났어요」 뒤 칸과 요약은 없다", !ended0.some((j) => /slot19|slot20|sum/.test(j)) && ended0.includes("ask18@17:50"), ended0.join(","));

const stay0 = list({ [D]: { ...dawnEve, stay: [18] } });
check("「남아요」 한 토막은 다시 묻지 않는다", !stay0.includes("ask18@17:50") && stay0.includes("slot19@19:30"));

const late0 = list({ [D]: dawnEve }, kstAt(D, 19 * 60 + 40));
check("지난 알림은 빼고 넘긴다", late0.join(",") === "slot20@20:30,sum@21:10,day@2026-10-07", late0.join(","));
check("확인자료를 올린 날은 알림이 없다", jobsOf({ [D]: { ...dawnEve, done: true } }, midnight0).length === 0);

const ev = applyEvents({ [D]: dawnEve }, [
  { op: "done", date: D, hour: 19 },
  { op: "done", date: D, hour: 19 },
  { op: "missed", date: D, hour: 20 },
  { op: "leave", date: D, hour: 6 },
  { op: "stay", date: D, hour: 18 },
  { op: "end", date: D, minute: 1250 },
  { op: "end", date: D, minute: 1300 },
  { op: "done", date: "2026-10-08", hour: 19 },
]);
check(
  "답을 합친다(같은 답 두 번은 한 번, 끝난 때는 이른 쪽)",
  ev[D].pressed.join() === "19" && ev[D].missed.join() === "20" && ev[D].left.join() === "6" && ev[D].stay.join() === "18" && ev[D].endedAt === 1250,
  JSON.stringify(ev[D]),
);
check("남기지 않은 날의 답은 버린다", ev["2026-10-08"] === undefined);
const flip = applyEvents(ev, [{ op: "done", date: D, hour: 20 }]);
check("「못 눌렀어요」 뒤 「눌렀어요」면 눌렀어요로 바뀐다", flip[D].pressed.join() === "19,20" && flip[D].missed.length === 0);
check("「올렸어요」는 그날을 닫는다", applyEvents({ [D]: dawnEve }, [{ op: "uploaded", date: D }])[D].done === true);
const readBack = readEvents([
  { op: "done", date: D, hour: 19 },
  { op: "done", date: D, hour: 24 },
  { op: "end", date: "10/7", minute: 10 },
  { op: "end", date: D, minute: 1441 },
  { op: "send", date: D },
  "junk",
  { op: "uploaded", date: D },
]);
check("앱이 넘긴 답에서 틀린 줄은 버린다", readBack.length === 2 && readBack[0].op === "done" && readBack[1].op === "uploaded", JSON.stringify(readBack));
const serverJobs = push.readJobs(jobsOf({ [D]: dawnEve }, midnight0), midnight0);
check("웹 푸시 서버는 묻기·요약을 버리고 칸·다음 날만 맡는다", serverJobs.every((j) => j.kind === "slot" || j.kind === "day") && serverJobs.length === 6, String(serverJobs.length));

console.log(`\n${checked - problems.length}/${checked}`);
if (problems.length > 0) {
  console.error("\n어긋남:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
