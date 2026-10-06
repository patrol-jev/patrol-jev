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
import { applyEvents, DEFAULT_PREFS, jobsOf, offHoursOf, readEvents, readPrefs, segmentsOf } from "../src/core/overtime/alarms.ts";
import { ALARM_OFF, BASIC, lineOf, sentencesOf } from "../src/core/overtime/talk.ts";
import { answer, readDate, replyTo, searchFaq, stepReply, STEPS } from "../src/core/overtime/chat.ts";
import { holidayDates, holidayLabel, isHoliday } from "../src/core/overtime/holidays.ts";

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
const list2 = (days, prefs) => jobsOf(days, midnight0, prefs).map((j) => `${j.kind}${j.hour ?? ""}@${j.kind === "day" ? j.date : clock(j)}`);

const segs = segmentsOf(dawnEve);
check("06~21 신청은 출근 전·퇴근 뒤 두 토막", segs.length === 2 && segs[0].first === 6 && segs[0].until === 9 && segs[1].first === 18 && segs[1].until === 21, JSON.stringify(segs));
const base0 = list({ [D]: dawnEve });
check(
  "묻기는 토막 10분 전, 칸은 권장 시각과 50분, 요약은 끝나고 10분 뒤, 다음 날 09:10",
  base0.join(",") ===
    "ask6@05:50,slot6@06:30,slot6@06:50,slot7@07:30,slot7@07:50,slot8@08:30,slot8@08:50,ask18@17:50,slot19@19:30,slot19@19:50,slot20@20:30,slot20@20:50,sum@21:10,day@2026-10-07",
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
check("지난 알림은 빼고 넘긴다", late0.join(",") === "slot19@19:50,slot20@20:30,slot20@20:50,sum@21:10,day@2026-10-07", late0.join(","));
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
check("웹 푸시 서버는 묻기·요약을 버리고 칸·다음 날만 맡는다", serverJobs.every((j) => j.kind === "slot" || j.kind === "day") && serverJobs.length === 11, String(serverJobs.length));

// ⑯ 알림 설정: 받는 시간 · 묻는 때
const P = (over) => ({ ...DEFAULT_PREFS, ...over });
const morning7 = list2({ [D]: dawnEve }, P({ from: 7 * 60, to: 23 * 60 }));
check(
  "받는 시간 07:00~ 이면 새벽 묻기는 07:00 으로 미루고 06:30 칸은 울리지 않는다",
  morning7.join(",") === "ask6@07:00,slot7@07:30,slot7@07:50,slot8@08:30,slot8@08:50,ask18@17:50,slot19@19:30,slot19@19:50,slot20@20:30,slot20@20:50,sum@21:10,day@2026-10-07",
  morning7.join(","),
);
const morning9 = list2({ [D]: dawnEve }, P({ from: 9 * 60, to: 23 * 60 }));
check("받는 시간 전에 끝나는 토막은 통째로 조용하다", !morning9.some((j) => /ask6|slot6|slot7|slot8/.test(j)) && morning9[0] === "ask18@17:50", morning9.join(","));
const night = list2({ [D]: dawnEve }, P({ from: 7 * 60, to: 20 * 60 }));
check("받는 시간 뒤의 칸과 요약은 울리지 않는다", !night.some((j) => /slot20|sum/.test(j)) && night.includes("slot19@19:30"), night.join(","));
const late10 = jobsOf({ [D]: dawnEve }, midnight0, P({ from: 10 * 60, to: 23 * 60 })).find((j) => j.kind === "day");
check("다음 날 알림도 받는 시간 시작으로 미룬다", late10.at === kstAt("2026-10-08", 10 * 60));
const ask30 = list2({ [D]: dawnEve }, P({ askBefore: 30 }));
const ask0 = list2({ [D]: dawnEve }, P({ askBefore: 0 }));
check("「남으세요?」 30분 전 / 시작할 때", ask30.includes("ask18@17:30") && ask0.includes("ask18@18:00"), `${ask30.join(",")} | ${ask0.join(",")}`);
const holStart = list2({ [D]: { ...dawnEve, holiday: true } }, P({ askBefore: 0 }));
check("휴일 첫 토막은 고른 때보다 이르게 30분 전", holStart[0] === "ask6@05:30" && holStart.includes("ask18@18:00"), holStart.join(","));
const lateNight = noteFrom(planDay(day({ spans: [r("21:00", "24:00")] })));
check("하루 종일이면 자정에 끝나는 날도 요약(00:10)", jobsOf({ [D]: lateNight }, midnight0).some((j) => j.kind === "sum" && j.at === kstAt("2026-10-08", 10)));
check("저장된 설정이 틀리면 기본으로", JSON.stringify(readPrefs({ from: 600, to: 300, askBefore: -5, sound: "no" })) === JSON.stringify(DEFAULT_PREFS));
check("저장된 설정을 읽는다", JSON.stringify(readPrefs({ from: 420, to: 1380, askBefore: 30, sound: false })) === JSON.stringify({ from: 420, to: 1380, askBefore: 30, sound: false }));

// ⑰ 말풍선(talk.ts): 상태마다 한 마디, 위에서부터 먼저 맞는 것
const at = (date, text) => kstAt(date, t(text));
const say = (over) => lineOf({ now: at(D, "12:00"), days: { [D]: dawnEve }, date: null, draft: null, alarm: true, native: true, ...over });
const said = [];
const hear = (over) => {
  const line = say(over);
  said.push(line.text, line.sub ?? "");
  return line;
};
check("처음엔 기본 안내", hear({ days: {} }).text === BASIC);
const yday = hear({ now: at(nextDate(D), "09:10") });
check("다음 날엔 확인자료 차례 + 올렸어요", yday.text === `어제 ${dayLabel(D)} 초과 확인자료 올릴 차례예요.` && yday.uploaded === D, yday.text);
check("사유 쓸 칸이 하나면 그 칸", yday.sub.startsWith("사유 쓸 칸은 18~19시 하나예요."), yday.sub);
const ydayMissed = hear({ now: at(nextDate(D), "09:10"), days: { [D]: { ...dawnEve, missed: [19] } } });
check("못 눌렀다고 한 칸도 사유 칸에 더한다", ydayMissed.sub.startsWith("사유 쓸 칸은 18~19시, 19~20시 모두 2칸이에요."), ydayMissed.sub);
check("올린 날은 말하지 않는다", hear({ now: at(nextDate(D), "09:10"), days: { [D]: { ...dawnEve, done: true } } }).text === BASIC);
const slot19 = hear({ now: at(D, "19:05") });
check("지금 칸이면 권장 시각 + 눌렀어요", slot19.text === "지금 19~20시 칸이에요. 19:30쯤 [확인] 눌러 주세요." && slot19.press === 19, slot19.text);
check("권장 시각이 지났으면 바로 누르라고", hear({ now: at(D, "19:40") }).text === "지금 19~20시 칸이에요. [확인] 눌러 주세요.");
const pressed19 = hear({ now: at(D, "19:40"), days: { [D]: { ...dawnEve, pressed: [19] } } });
check("누른 칸이면 다음 칸을 말한다", pressed19.text === "19~20시 칸은 눌렀어요. 다음 20~21시 칸에 또 알려 드릴게요." && pressed19.press === undefined, pressed19.text);
const meal18 = hear({ now: at(D, "18:10") });
check(
  "사유 칸이면 사유를 말한다",
  meal18.text === "지금 18~19시 칸은 [확인] 대신 사유를 쓰는 칸이에요." && meal18.sub === "내일 미기록 사유에 「저녁 식사」라고 적어요.",
  `${meal18.text} ${meal18.sub}`,
);
const sayDawn = hear({ now: at(D, "05:00") });
check(
  "토막 전엔 걸린 시간 + 묻는 때(앱)",
  sayDawn.text === "오늘 초과 06:00~09:00, 18:00~21:00 걸려 있어요." && sayDawn.sub === "05:50에 남으실지 여쭤볼게요.",
  `${sayDawn.text} ${sayDawn.sub}`,
);
const noon = hear({});
check("토막 사이엔 남은 것만", noon.text === "오늘 남은 초과는 18:00~21:00 걸려 있어요." && noon.sub === "17:50에 남으실지 여쭤볼게요.", `${noon.text} ${noon.sub}`);
check("웹이면 다음 [확인] 알림을 말한다(사유 칸은 건너뜀)", hear({ native: false }).sub === "19:30쯤 [확인] 알림을 드릴게요.");
const after0 = nextDate(D);
const offOff = hear({ alarm: false });
check("알림이 꺼져 있으면 켜자고(누르는 라벨)", offOff.offer === "alarm" && offOff.sub === undefined && ALARM_OFF === "알림을 켜 두면 칸마다 제가 챙길게요.");
check("알림이 켜져 있으면 권하지 않는다", hear({}).offer === undefined && hear({ days: { [after0]: dawnEve }, date: after0 }).offer === undefined);
check("남긴 앞날도 알림이 꺼져 있으면 권한다", hear({ alarm: false, days: { [after0]: dawnEve }, date: after0 }).offer === "alarm");
check(
  "기본 안내는 세 문장으로 친다",
  JSON.stringify(sentencesOf(BASIC)) ===
    JSON.stringify([
      "초과가 걸린 시간에는 한 시간 칸마다 인사랑 [근무기록] → [확인]을 한 번 눌러요.",
      "지문과 퇴근확인은 그대로 따로 해요.",
      "못 누른 칸은 미기록 사유를 쓰고, 확인자료는 다음 날 날짜별로 한 건씩 올려요.",
    ]),
);
check("날짜의 점에서는 끊지 않는다", sentencesOf("어제 10/5(월) 초과 확인자료 올릴 차례예요.").length === 1);
check("묻는 때 설정을 따른다", hear({ prefs: P({ askBefore: 30 }) }).sub === "17:30에 남으실지 여쭤볼게요.");
const ended = hear({ now: at(D, "19:50"), days: { [D]: { ...dawnEve, endedAt: t("19:40") } } });
check("「끝났어요」 뒤엔 여기까지", ended.text === "오늘은 여기까지예요. 나머지 칸은 안 울릴게요.", ended.text);
check("남은 토막을 「안 남아요」 했어도 여기까지", hear({ days: { [D]: { ...dawnEve, left: [18] } } }).text.startsWith("오늘은 여기까지"));
check("다 지났으면 수고했다고", hear({ now: at(D, "22:00") }).text === "오늘 칸은 다 지났어요. 수고하셨어요.");
const after = nextDate(D);
check("고른 날, 시간 전", hear({ days: {}, date: after, draft: { clicks: 0, reasons: 0 } }).text === `${dayLabel(after)} 초과 시간을 넣어 주세요.`);
check("고른 날, 셈 결과", hear({ days: {}, date: after, draft: { clicks: 2, reasons: 1 } }).text === "3칸이에요. [확인] 2칸, 사유 1칸.");
check("고른 날을 남겼으면", hear({ days: { [after]: dawnEve }, date: after }).text === `${dayLabel(after)} 초과를 남겼어요. 그날 칸마다 챙길게요.`);
check("말풍선에 긴 줄표 없음", said.every((s) => !s.includes(String.fromCharCode(0x2014))));

// ⑱ 휴일 표(holidays.ts): 2026 · 2027 공휴일과 대체공휴일
check("2026 · 2027 표의 날 수", holidayDates().length === 40, String(holidayDates().length));
check("표의 날은 모두 2026 · 2027", holidayDates().every((d) => d.startsWith("2026-") || d.startsWith("2027-")));
check("한글날 · 대체공휴일(개천절)은 휴일", isHoliday("2026-10-09") && isHoliday("2026-10-05") && holidayLabel("2026-10-05") === "대체공휴일(개천절)");
check("추석 연휴 사흘", ["2026-09-24", "2026-09-25", "2026-09-26"].every(isHoliday));
check("2027 설날 대체공휴일 2/9", isHoliday("2027-02-09") && holidayLabel("2027-02-07") === "설날");
check("평일은 휴일 아님", !isHoliday("2026-10-06") && holidayLabel("2026-10-06") === null);
check("토 · 일은 표에 없어도 휴일", isHoliday("2026-10-10") && holidayLabel("2026-10-10") === "토요일" && isHoliday("2028-01-02"));

// ⑲ 채팅(chat.ts): 말을 읽어 제안을 만든다. 모델 없음
const C = { today: "2026-10-06", date: null, holiday: false, base: { from: "09:00", to: "18:00" }, spans: [{ from: "18:00", to: "21:00" }], gaps: [], nowMinute: 13 * 60 + 19 };
const ask = (text, over = {}) => replyTo(text, { ...C, ...over });
const said2 = [];
const keep2 = (r) => {
  said2.push(r.text, r.sub ?? "", ...(r.chips ?? []));
  return r;
};
const spanOf = (r) => (r.proposal?.spans ?? []).map((x) => `${x.from}~${x.to}`).join(",");
const gapOf = (r) => (r.proposal?.gaps ?? []).map((x) => `${x.kind}${x.from}~${x.to}`).join(",");
check("날짜 읽기: 오늘 · 내일 · 모레", readDate("오늘", C.today).date === "2026-10-06" && readDate("내일", C.today).date === "2026-10-07" && readDate("모레", C.today).date === "2026-10-08");
check("날짜 읽기: 10/9 · 10월 9일", readDate("10/9 야근", C.today).date === "2026-10-09" && readDate("10월 9일", C.today).date === "2026-10-09");
check("날짜 읽기: 토요일 · 다음 주 월요일", readDate("토요일", C.today).date === "2026-10-10" && readDate("다음 주 월요일", C.today).date === "2026-10-12");
check("날짜 읽기: 12월에 1월 3일은 내년", readDate("1월 3일", "2026-12-20").date === "2027-01-03");
const r1 = keep2(ask("오늘 6시부터 9시까지"));
check("평일 6시~9시는 저녁 18~21", spanOf(r1) === "18:00~21:00" && r1.proposal.date === "2026-10-06" && r1.sub === "그러면 3칸이에요. [확인] 3칸, 사유 0칸.", `${spanOf(r1)} ${r1.sub}`);
const r2 = keep2(ask("6시부터 9시까지 하고 7시에 밥 먹었어"));
check("토막 + 식사(시각 하나면 1시간)", spanOf(r2) === "18:00~21:00" && gapOf(r2) === "meal19:00~20:00" && r2.sub.includes("사유 1칸"), `${spanOf(r2)} ${gapOf(r2)}`);
check("「7시에 저녁 30분」은 식사 30분", gapOf(keep2(ask("7시에 저녁 30분"))) === "meal19:00~19:30");
check("「7시 30분에 밥」은 19:30부터 1시간", gapOf(keep2(ask("7시 30분에 밥"))) === "meal19:30~20:30");
const r3 = keep2(ask("내일 휴일 10시~5시"));
check("휴일은 10시~5시 = 10~17", spanOf(r3) === "10:00~17:00" && r3.proposal.holiday === true, spanOf(r3));
const r4 = keep2(ask("10월 9일 1시부터 6시"));
check("표의 공휴일은 저절로 휴일근무(한글날)", r4.proposal.holiday === true && spanOf(r4) === "13:00~18:00" && r4.text.includes("한글날"), r4.text);
check("「9시까지」는 퇴근부터", spanOf(keep2(ask("9시까지"))) === "18:00~21:00");
check("「퇴근하고 3시간」", spanOf(keep2(ask("퇴근하고 3시간"))) === "18:00~21:00");
check("「출근 전 7시부터 9시」는 오전", spanOf(keep2(ask("출근 전 7시부터 9시"))) === "07:00~09:00");
check("「자정까지」", spanOf(keep2(ask("자정까지"))) === "18:00~24:00");
check("「저녁 7시부터 밤 11시」", spanOf(keep2(ask("저녁 7시부터 밤 11시"))) === "19:00~23:00");
const r5 = keep2(ask("토요일 9시~6시 점심 12시~1시"));
check("한 마디에 두 토막(초과 + 점심)", spanOf(r5) === "09:00~18:00" && gapOf(r5) === "meal12:00~13:00", `${spanOf(r5)} ${gapOf(r5)}`);
const r6 = keep2(ask("2시부터 3시까지 병원 외출", { gaps: [{ kind: "meal", from: "18:00", to: "19:00" }] }));
check("비운 때만 말하면 지금 것에 더한다", gapOf(r6) === "meal18:00~19:00,away14:00~15:00" && r6.proposal.spans === undefined, gapOf(r6));
check("현장 · 외근", gapOf(keep2(ask("8시~9시 현장 점검"))) === "field20:00~21:00");
check("유연근무 10시~7시는 내 근무", JSON.stringify(keep2(ask("유연근무 10시~7시")).proposal.base) === JSON.stringify({ from: "10:00", to: "19:00" }));
check("「남겨 줘」는 고른 날이 있어야", keep2(ask("남겨 줘")).proposal === undefined && ask("남겨 줘", { date: "2026-10-06" }).proposal.keep === true);
check("「알림 켜 줘」", keep2(ask("알림 켜 줘")).proposal.alarm === true);
check("「평일로」는 휴일을 끈다", keep2(ask("평일로 해 줘", { holiday: true })).proposal.holiday === false);
const q1 = keep2(ask("식사 시간도 사유 쓰나요?"));
check("질문은 묻고 답하기 자료로 답한다", q1.proposal === undefined && q1.text.startsWith("그 칸에서 [확인]을 못 눌렀다면") && q1.sub.includes("출처 사용 안내"), q1.text);
check("알림 질문", keep2(ask("알림이 안 떠요")).text.startsWith("알림은 인사랑에 로그인해"));
check("자료에 없는 건 없다고 한다", keep2(answer("주차장은 어디인가요?")).text.startsWith("그건 제가 가진 자료에 없어요"));
check("찾기는 셋까지", searchFaq("알림 확인자료 사유 식사").length <= 3);
check("같은 말이면 같은 답", JSON.stringify(ask("오늘 6시부터 9시까지")) === JSON.stringify(ask("오늘 6시부터 9시까지")));
check("순서: 다음 · 3번 · 처음", stepReply("다음", 0).at === 1 && stepReply("3번", 0).at === 2 && stepReply("처음부터", 5).at === 0 && STEPS.length === 8);
check("순서 탭에서 물으면 답한다", stepReply("반려되면요?", 2).reply?.text.startsWith("확인자료 상세 화면에서") === true);
check("채팅 말에 긴 줄표 없음", said2.concat(STEPS).every((s) => !s.includes(String.fromCharCode(0x2014))));

// ⑳ 시각 읽기 보완: 0 붙인 24시간 표기 · 오후 12시 = 자정 · 지금 시각으로 고르기
const at0119 = { nowMinute: 1 * 60 + 19 };
const at1319 = { nowMinute: 13 * 60 + 19 };
check("「초과 06:00~09:00 , 18:00~24:00」 두 토막 그대로", spanOf(keep2(ask("초과 06:00~09:00 , 18:00~24:00"))) === "06:00~09:00,18:00~24:00");
check("「오전 6시~9시 , 오후6시~12시」", spanOf(keep2(ask("오전 6시~9시 , 오후6시~12시"))) === "06:00~09:00,18:00~24:00");
check("「오전6시부터 오후12시」는 06~24", spanOf(keep2(ask("오전6시부터 오후12시"))) === "06:00~24:00");
check("새벽 1:19에 「6시~9시」는 오전", spanOf(keep2(ask("6시~9시", at0119))) === "06:00~09:00");
check("오후 1:19에 「6시~9시」는 저녁", spanOf(keep2(ask("6시~9시", at1319))) === "18:00~21:00");
check("아침 8:30에 「6시~9시」는 아직 오전 토막 안", spanOf(ask("6시~9시", { nowMinute: 8 * 60 + 30 })) === "06:00~09:00");
const unsure = keep2(ask("내일 6시~9시", at0119));
check(
  "내일의 「6시~9시」는 지금 시각으로 짐작하지 않고 묻는다",
  unsure.proposal === undefined &&
    unsure.text === "10/7(수) 아침 06:00~09:00일까요, 저녁 18:00~21:00일까요?" &&
    unsure.choices.map((c) => spanOf(c.reply)).join("|") === "06:00~09:00|18:00~21:00",
  unsure.text,
);
check("새벽에 물어도 낮에 물어도 같은 되묻기", JSON.stringify(ask("내일 6시~9시", at0119)) === JSON.stringify(ask("내일 6시~9시", at1319)));
check("고르면 「넣을까요?」로 이어진다", unsure.choices[0].reply.text === "10/7(수) 초과 06:00~09:00로 넣을까요?" && unsure.choices[0].reply.yes === "네, 넣어 주세요");
check("되묻던 중 「오전으로」는 아침", spanOf(replyTo("오전으로", { ...C, ...at0119 }, unsure.choices[1].reply.proposal)) === "06:00~09:00");
check("아침이면 근무와 겹치는 「7시~10시」는 묻지 않고 저녁", spanOf(ask("내일 7시~10시")) === "19:00~22:00" && ask("내일 7시~10시").choices === undefined);
check("오전 · 오후를 말하면 묻지 않는다", spanOf(ask("내일 오전 6시~9시")) === "06:00~09:00" && spanOf(ask("내일 저녁 6시~9시")) === "18:00~21:00");
check("휴일은 묻지 않는다", ask("내일 휴일 10시~5시").choices === undefined);
check("낮 12시는 정오", spanOf(ask("휴일 9시부터 낮 12시")) === "09:00~12:00");

// ㉑ 바로 앞 제안 하나만 기억한다
const first6 = ask("6시~9시", at0119);
const again = (text, prev = first6.proposal, over = at0119) => replyTo(text, { ...C, ...over }, prev);
check("직전: 새벽엔 06~09", spanOf(first6) === "06:00~09:00");
for (const said of ["오후로", "ㄴㄴ 오후로", "아니 오후로", "no 오후", "저녁으로요"]) {
  const r = keep2(again(said));
  check(`직전 + 「${said}」 = 18~21`, spanOf(r) === "18:00~21:00" && r.text === "초과 18:00~21:00로 넣을까요?", `${spanOf(r)} ${r.text}`);
}
const back = again("오전으로", again("오후로").proposal);
check("「오전으로」는 다시 06~09", spanOf(back) === "06:00~09:00");
check("식사만 말했으면 식사를 뒤집는다", gapOf(again("오전으로", ask("7시에 밥").proposal)) === "meal07:00~08:00");
const tmr = keep2(again("내일로", ask("오늘 6시부터 9시까지", at1319).proposal, at1319));
check("「내일로」는 날만 바꾼다", tmr.proposal.date === "2026-10-07" && spanOf(tmr) === "18:00~21:00", JSON.stringify(tmr.proposal));
check("「10/9로」는 공휴일이면 휴일근무로", again("10/9로").proposal.holiday === true);
check("「응」 · 「ㅇㅇ」 · 「좋아」는 넣기", ["응", "ㅇㅇ", "좋아", "네"].every((t) => again(t).accept === true));
check("「ㄴㄴ」 · 「아니」만 치면 넣지 않기", ["ㄴㄴ", "아니", "no"].every((t) => again(t).reject === true));
check("앞 제안이 없으면 「오후로」를 새 말로 읽는다", replyTo("오후로", C).accept === undefined && replyTo("응", C).accept === undefined);
check("새 시각을 말하면 새로 읽는다", spanOf(again("7시~10시", first6.proposal, at1319)) === "19:00~22:00");

// ㉒ 「바꿀래」 · 「빼 줘」
const kept = { date: "2026-10-06", saved: true, spans: [{ from: "06:00", to: "09:00" }, { from: "18:00", to: "24:00" }] };
const change = keep2(ask("바꿀래", kept));
check("「바꿀래」는 지금 것을 알려 주고 묻는다", change.text === "좋아요. 지금 10/6(화)에 남긴 초과는 06:00~09:00, 18:00~24:00로 되어 있어요. 어떻게 바꿀까요?" && change.proposal === undefined && change.chips.includes("이 날 빼 줘"), change.text);
check("「수정할래요」 · 「바꾸고 싶어」도", ask("수정할래요", kept).text.startsWith("좋아요. 지금") && ask("바꾸고 싶어", kept).text.startsWith("좋아요. 지금"));
check("「바꿀래」 다음에 새 시간을 말하면 그대로 읽는다", spanOf(replyTo("6시~10시", { ...C, ...kept, ...at1319 }, change.proposal)) === "18:00~22:00");
check("시각을 같이 말하면 바로 읽는다", spanOf(ask("7시~10시로 바꿔 줘", { ...kept, ...at1319 })) === "19:00~22:00");
check("「이 날 빼 줘」", keep2(ask("이 날 빼 줘", kept)).proposal?.drop === true && ask("이 날 빼 줘", { date: "2026-10-06" }).proposal === undefined);
check("「식사 빼 줘」는 남긴 날 빼기가 아니다", ask("식사 빼 줘", kept).proposal?.drop !== true);

// ㉓ 「네」 단추의 글은 묻는 말과 짝이 맞는다
const pairs2 = [
  [ask("이 날 빼 줘", kept), "뺄까요?", "네, 빼 주세요"],
  [ask("남겨 줘", { date: "2026-10-06" }), "남길까요?", "네, 남겨 주세요"],
  [ask("알림 켜 줘"), "켤까요?", "네, 켜 주세요"],
  [ask("오늘 6시부터 9시까지", at1319), "넣을까요?", "네, 넣어 주세요"],
  [ask("6시~10시", { ...kept, ...at1319 }), "바꿀까요?", "네, 바꿔 주세요"],
  [ask("내일 휴일"), "할까요?", "네, 그렇게 해 주세요"],
];
for (const [r, ends, yes] of pairs2) check(`「${ends}」에는 「${yes}」`, r.text.includes(ends) && r.yes === yes, `${r.text} / ${r.yes}`);
check("제안이 있는 답에는 늘 「네」 글이 있다", pairs2.every(([r]) => r.proposal && r.yes));

// ⑰ 정각 10분 전 한 번 더 · 지운 칸 · 오늘 초과 끝(2026-10-07)
const again0 = jobsOf({ [D]: dawnEve }, midnight0).filter((j) => j.kind === "slot" && j.again);
check("한 번 더 알림은 [확인] 칸마다 매시 50분", again0.map((j) => `${j.hour}@${clock(j)}`).join(",") === "6@06:50,7@07:50,8@08:50,19@19:50,20@20:50", again0.map((j) => j.hour).join());
check("「눌렀어요」 한 칸은 50분 알림도 없다", !jobsOf({ [D]: { ...dawnEve, pressed: [19] } }, midnight0).some((j) => j.kind === "slot" && j.hour === 19));
const short0 = { clicks: [{ hour: 18, at: 18 * 60 + 30, end: 18 * 60 + 40 }], reasons: [], exclusions: [], done: false };
check("누를 틈이 50분 전에 끝나면 한 번 더는 없다", !list({ [D]: short0 }).includes("slot18@18:50") && list({ [D]: short0 }).includes("slot18@18:30"), list({ [D]: short0 }).join(","));
const end45 = list({ [D]: { ...dawnEve, endedAt: 19 * 60 + 45 } });
check("「끝났어요」 뒤의 50분 알림은 없다", end45.includes("slot19@19:30") && !end45.includes("slot19@19:50"), end45.join(","));
const cutAm = jobsOf({ [D]: { ...dawnEve, cut: [6, 7, 8] } }, midnight0);
check("출근 전 칸을 다 지우면 그 토막은 묻기 · 칸 알림이 없다", !cutAm.some((j) => (j.kind === "slot" || j.kind === "ask") && j.hour < 9) && cutAm.some((j) => j.kind === "ask" && j.hour === 18));
check("지운 칸은 요약 칸 수에서 빠진다", cutAm.find((j) => j.kind === "sum").clicks === 2);
const cut6 = list({ [D]: { ...dawnEve, cut: [6] } });
check("앞 칸만 지우면 남은 첫 칸 앞에서 묻는다", cut6[0] === "ask7@06:50" && !cut6.some((j) => /slot6/.test(j)), cut6.join(","));
check("「안 남아요」가 토막 가운데 칸으로 와도 토막 전체가 꺼진다", [...offHoursOf({ ...dawnEve, left: [7] })].sort((a, b) => a - b).join() === "6,7,8");
const pushAgain = push.readJobs(jobsOf({ [D]: dawnEve }, midnight0), midnight0).find((j) => j.kind === "slot" && j.again);
check("웹 푸시도 한 번 더를 맡고 🟠 로 다르게 쓴다", pushAgain && push.messageOf(pushAgain).body.startsWith("🟠") && !push.messageOf({ ...pushAgain, again: undefined }).body.startsWith("🟠"));

const N = nextDate(D);
const nextLine = (note) => lineOf({ now: at(N, "09:30"), days: { [D]: note }, date: null, draft: null, alarm: true, native: true });
const partCut = nextLine({ ...dawnEve, cut: [19, 20] });
check("다음 날: 지운 칸은 사유 쓸 칸에서 빼고 따로 말한다", partCut.sub.startsWith("사유 쓸 칸은 18~19시 하나예요.") && partCut.sub.includes("19~20시, 20~21시는 남지 않은 칸이에요."), partCut.sub);
const allCut = nextLine({ ...dawnEve, cut: [6, 7, 8, 18, 19, 20] });
check("다음 날: 다 지운 날은 「확인했어요」로 닫는다", allCut.text.includes("다 지우셨어요") && allCut.close === "확인했어요" && allCut.uploaded === D, allCut.text);
const lateLine = say({ now: at(D, "19:52") });
check("정각 10분 전인데 안 누른 칸이면 말풍선이 주황(late)", lateLine.late === true && lateLine.press === 19 && lateLine.text.includes("10분 남았어요"), lateLine.text);
check("50분 전에는 late 가 아니다", say({ now: at(D, "19:35") }).late === undefined);
check("오늘 칸이 남아 있으면 「오늘 초과 끝」 단추", say({ now: at(D, "19:10") }).end === true && say({ now: at(D, "12:00") }).end === true);
const endedLine = say({ now: at(D, "19:10"), days: { [D]: { ...dawnEve, endedAt: 19 * 60 + 5 } } });
check("끝낸 뒤에는 「여기까지」, 단추 없음", endedLine.text.startsWith("오늘은 여기까지예요.") && endedLine.end === undefined, endedLine.text);
const cutToday = say({ now: at(D, "19:10"), days: { [D]: { ...dawnEve, cut: [19, 20] } } });
check("오늘 남은 칸을 다 지우면 「여기까지」", cutToday.text.startsWith("오늘은 여기까지예요."), cutToday.text);

const savedToday = { date: "2026-10-06", saved: true };
const cutAsk = ask("출근 전 지워 줘", savedToday);
check("「출근 전 지워 줘」 → 출근 전 칸 지우기 제안", cutAsk.proposal?.cut === "am" && cutAsk.yes === "네, 지워 주세요" && cutAsk.text.includes("출근 전 칸을 지울까요?"), cutAsk.text);
check("「퇴근 후 칸 안 했어」 → 퇴근 후", ask("퇴근 후 칸 안 했어", savedToday).proposal?.cut === "pm");
check("휴일은 「오후 지워」 → 오후 칸", ask("오후 지워", { ...savedToday, holiday: true }).text.includes("오후 칸을 지울까요?"));
check("지우기 제안 뒤 「오후로」 → 퇴근 후로 뒤집기", replyTo("오후로", { ...C, ...savedToday }, cutAsk.proposal).proposal?.cut === "pm");
check("남기지 않은 날은 지울 칸이 없다", ask("출근 전 지워").proposal === undefined);
check("「이 날 빼 줘」는 그대로 날 빼기", ask("이 날 빼 줘", savedToday).proposal?.drop === true);
const endAsk = ask("오늘 초과 끝", savedToday);
check("「오늘 초과 끝」 → 끝내기 제안", endAsk.proposal?.end === true && endAsk.yes === "네, 끝내 주세요", endAsk.text);
check("「퇴근했어요」 · 「오늘은 끝났어요」도", ask("퇴근했어요", savedToday).proposal?.end === true && ask("오늘은 끝났어요", savedToday).proposal?.end === true);
check("다른 날이거나 안 남긴 날은 끝낼 것이 없다", ask("초과 끝").proposal === undefined && ask("초과 끝", { date: "2026-10-08", saved: true }).proposal === undefined);

console.log(`\n${checked - problems.length}/${checked}`);
if (problems.length > 0) {
  console.error("\n어긋남:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
