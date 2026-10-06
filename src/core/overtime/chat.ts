/**
 * 초과기록 채팅. 사람이 친 말을 **코드가** 읽어 PJ 의 답과 제안을 만든다. 모델을 부르지 않는다.
 * 같은 말이면 늘 같은 답이다. 화면은 답을 그리고, 사람이 「네」를 누를 때만 제안을 넣는다.
 *
 * 읽는 것:
 *   날짜   = 오늘 · 내일 · 모레 · 어제 · 10/9 · 10월 9일 · (다음 주) 토요일
 *   휴일   = 「휴일」 · 「공휴일」 · 「주말」 은 휴일근무, 「평일」 은 평일
 *   시각   = 18:00 · 18시 · 6시 반 · 오후 7시 · 저녁 7시 · 밤 10시 · 아침 7시 · 자정
 *   토막   = 두 시각(「6시부터 9시까지」, 「18~21시」), 「9시까지」(퇴근부터), 「3시간」(퇴근부터)
 *   비운 때 = 같은 마디에 밥 · 식사 · 먹 → 식사, 외출 · 병원 · 은행 · 용무 → 외출, 현장 · 외근 · 출장 · 점검 → 현장
 *   근무   = 같은 마디에 「근무시간」 · 「유연」 이 있으면 내 근무시간
 *   질문   = 물음표나 「~나요」 같은 끝, 시각이 없는 말 → 묻고 답하기 자료에서 찾는다
 *
 * 시각에 오전 · 오후가 없으면: 12 이상과 「06:00」처럼 0을 붙여 쓴 것은 그대로.
 * 오늘의 「6시~9시」는 지금 시각을 본다(아직 9시 전이면 오전, 지났으면 저녁). 「오후 12시」 · 「밤 12시」는 자정.
 * 오늘이 아닌 평일에 아침(출근 전에 끝남)으로도 저녁으로도 말이 되면 짐작하지 않고 「아침일까요, 저녁일까요?」로 묻는다.
 * 그 밖에는 평일은 오후로 읽고(초과는 대개 퇴근 뒤),
 * 「출근 전」 · 「아침」 · 「새벽」 · 「오전」 이 같은 마디에 있으면 오전으로 읽는다. 휴일은 7~11시는 오전, 1~6시는 오후.
 * 끝이 시작보다 앞서면 끝에 12시간을 더해 본다. 그래도 앞서면 그 토막은 버린다.
 *
 * 판단(칸 · 사유)은 여기서 하지 않는다. 제안을 `plan.ts` 에 넣어 칸 수를 미리 보여 줄 뿐이다.
 */

import { FAQ, type Faq } from "./faq";
import { holidayLabel, isHoliday } from "./holidays";
import { dayLabel, hhmm, HOUR, kstAt, kstToday, parseHhmm, planDay, type GapKind, type Range } from "./plan";

export interface TextRange {
  from: string;
  to: string;
}

export interface TextGap extends TextRange {
  kind: GapKind;
}

/** 채팅이 읽을 때 아는 것. 지금 화면에 넣은 값. */
export interface ChatContext {
  today: string;
  /** 지금 고른 날. 안 골랐으면 null. */
  date: string | null;
  holiday: boolean;
  base: TextRange;
  spans: TextRange[];
  gaps: TextGap[];
  /** 지금 한국 시각(그날의 분). 오늘 날짜에서 오전 · 오후 없는 토막을 고를 때 쓴다. */
  nowMinute?: number;
  /** 고른 날을 이미 남겼나. */
  saved?: boolean;
}

/** 「네」를 누르면 넣을 것. 빈 칸은 건드리지 않는다. */
export interface Proposal {
  date?: string;
  holiday?: boolean;
  base?: TextRange;
  spans?: TextRange[];
  gaps?: TextGap[];
  /** 이 날을 초과로 남긴다. */
  keep?: boolean;
  /** 알림을 켠다. */
  alarm?: boolean;
  /** 남긴 날을 뺀다(그날 알림도 멈춘다). */
  drop?: boolean;
  /** 오늘 초과를 지금 끝낸다(남은 칸 알림이 멈춘다). */
  end?: boolean;
  /** 남긴 날의 오전(출근 전) · 오후(퇴근 후) 칸을 한 번에 지운다. 사전신청만 걸리고 안 남은 칸. */
  cut?: "am" | "pm";
}

export interface Reply {
  text: string;
  sub?: string;
  proposal?: Proposal;
  /** 이어서 눌러 볼 말(누르면 그 말을 보낸다). */
  chips?: string[];
  /** 아침인지 저녁인지 모를 때 되묻는 고르기. 누르면 그 답(`reply`)으로 이어진다. */
  choices?: Array<{ label: string; reply: Reply }>;
  /** 제안이 있을 때 「네」 단추의 글. 묻는 말의 동사와 짝을 맞춘다(뺄까요? → 네, 빼 주세요). */
  yes?: string;
  /** 직전 제안에 「응」 · 「아니」로 답했다. 화면이 「네」 · 「아니요」를 누른 것처럼 한다. */
  accept?: boolean;
  reject?: boolean;
}

/** 처음 보여 줄 말 예시. */
export const EXAMPLES = ["오늘 6시부터 9시까지", "7시에 저녁 30분", "내일 휴일 10시~5시"];
export const QUESTION_EXAMPLES = ["식사 시간도 사유 쓰나요?", "알림이 안 떠요", "다 눌렀어도 올려야 하나요?"];

const KIND_WORD: Record<GapKind, string> = { meal: "식사", away: "외출", field: "현장" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (date: string, days: number) => kstToday(kstAt(date, 12 * HOUR) + days * 24 * HOUR * 60_000);
const weekday = (date: string) => new Date(kstAt(date, 12 * HOUR)).getUTCDay();

/** 말에서 날짜를 찾는다. 찾은 자리는 지운 말도 돌려준다(날짜의 숫자를 시각으로 읽지 않게). */
export function readDate(text: string, today: string): { date: string | null; rest: string } {
  let rest = text;
  let date: string | null = null;
  const take = (re: RegExp, make: (m: RegExpExecArray) => string | null) => {
    if (date) return;
    const m = re.exec(rest);
    if (!m) return;
    const got = make(m);
    if (got && DATE.test(got)) {
      date = got;
      rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length);
    }
  };
  const year = Number(today.slice(0, 4));
  const ymd = (mo: number, d: number) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    // 지난달보다 더 앞이면 내년으로 본다(12월에 「1월 3일」).
    let y = year;
    const made = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (made < addDays(today, -60)) y += 1;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  take(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/, (m) => ymd(Number(m[1]), Number(m[2])));
  take(/(?<![\d:])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d:])/, (m) => ymd(Number(m[1]), Number(m[2])));
  take(/모레/, () => addDays(today, 2));
  take(/내일/, () => addDays(today, 1));
  take(/어제/, () => addDays(today, -1));
  take(/오늘|지금/, () => today);
  take(/(다음\s*주|담주|이번\s*주)?\s*([월화수목금토일])요일/, (m) => {
    const want = "일월화수목금토".indexOf(m[2]);
    const now = weekday(today);
    // 「다음 주」는 이번 주 그 요일에 7일을 더한다. 그냥 요일이면 오늘부터 가장 가까운 그 요일.
    const ahead = m[1] && /다음|담주/.test(m[1]) ? want - now + 7 : (want - now + 7) % 7;
    return addDays(today, ahead);
  });
  return { date, rest };
}

interface Point {
  minute: number;
  /** 오전 · 오후를 말했나. */
  fixed: boolean;
  /** 오전 · 오후 없이 1~11시. */
  bare: boolean;
  at: number;
  end: number;
}

const POINT = /(오전|오후|아침|저녁|밤|새벽|낮)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시(?!간)\s*(반|(\d{1,2})\s*분)?)|자정|정오/g;

function points(clause: string): Point[] {
  const out: Point[] = [];
  for (const m of clause.matchAll(POINT)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (m[0] === "자정") {
      out.push({ minute: 24 * HOUR, fixed: true, bare: false, at, end });
      continue;
    }
    if (m[0] === "정오") {
      out.push({ minute: 12 * HOUR, fixed: true, bare: false, at, end });
      continue;
    }
    let h = Number(m[2]);
    const min = m[3] !== undefined ? Number(m[3]) : m[4] === "반" ? 30 : m[5] !== undefined ? Number(m[5]) : 0;
    if (h > 24 || min > 59) continue;
    const mark = m[1];
    let fixed = false;
    if (mark === "오전" || mark === "아침" || mark === "새벽") {
      if (h === 12) h = 0;
      fixed = true;
    } else if (mark === "오후" || mark === "저녁" || mark === "밤") {
      // 「오후 12시」 · 「밤 12시」는 자정으로 읽는다(낮 12시는 「낮 12시」 · 「정오」).
      if (h < 12) h += 12;
      else if (h === 12 && min === 0) h = 24;
      fixed = true;
    } else if (mark === "낮") {
      if (h <= 6) h += 12;
      fixed = true;
    }
    // 「06:00」처럼 앞에 0을 붙여 쓴 시각은 24시간 표기로 보고 그대로 둔다.
    if (/^0\d$/.test(m[2])) fixed = true;
    out.push({ minute: h * HOUR + min, fixed, bare: !fixed && h >= 1 && h <= 11, at, end });
  }
  return out;
}

/** 오전 · 오후를 안 말한 시각을 고른다. */
function settle(p: Point, morning: boolean, holiday: boolean): number {
  if (!p.bare) return p.minute;
  if (morning) return p.minute;
  const h = Math.floor(p.minute / HOUR);
  if (holiday) return h >= 7 ? p.minute : p.minute + 12 * HOUR;
  return p.minute + 12 * HOUR;
}

/** 「3시간」 · 「30분」 · 「1시간 반」. 분. */
function duration(clause: string): number | null {
  const m = /(\d{1,2})\s*시간\s*(반|(\d{1,2})\s*분)?|(?<!시\s{0,2})(\d{1,3})\s*분(?!\s*(?:에|부터|까지))/.exec(clause);
  if (!m) return null;
  if (m[1] !== undefined) return Number(m[1]) * HOUR + (m[2] === "반" ? 30 : m[3] !== undefined ? Number(m[3]) : 0);
  return Number(m[4]);
}

function kindOf(clause: string): GapKind | "base" | null {
  if (/근무\s*시간|유연|정규\s*근무|내\s*근무/.test(clause)) return "base";
  if (/밥|식사|먹|도시락|점심|저녁(?!\s*\d{1,2}\s*[시:])/.test(clause)) return "meal";
  if (/외출|병원|은행|용무|볼일|사적/.test(clause)) return "away";
  if (/현장|외근|출장|점검/.test(clause)) return "field";
  return null;
}

const clauses = (text: string) =>
  text
    .split(/[,，.;\n]|그리고|그 다음|그다음|(?<=[가-힣])고\s+|하는데|인데/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .flatMap(pairs);

/**
 * 한 마디에 시각이 넷 이상이면(「9시~6시 점심 12시~1시」) 두 개씩 끊는다.
 * 앞 토막은 그 끝까지, 마지막 토막은 마디 끝까지 가져가 뒤에 붙은 말(「밥」)도 함께 본다.
 */
function pairs(clause: string): string[] {
  const ps = points(clause);
  if (ps.length < 4) return [clause];
  const out: string[] = [];
  let from = 0;
  for (let i = 1; i < ps.length; i += 2) {
    const last = i + 2 >= ps.length;
    const to = last ? clause.length : ps[i].end;
    out.push(clause.slice(from, to).trim());
    from = to;
    if (last) break;
  }
  return out.filter((c) => c.length > 0);
}

const QUESTION = /\?|？|나요|까요|가요|인가|하나|되나|돼요\?|어떻게|왜|뭐|무엇|언제|누가|얼마|몇\s*번|몇\s*분|있나|없나|해야|되죠|되요|돼\?|니\?|냐/;

/** 사람이 친 말에 PJ 가 답한다. */
export function replyTo(message: string, ctx: ChatContext, last?: Proposal): Reply {
  const text = message.trim().replace(/[～〜]/g, "~").replace(/\s+/g, " ");
  if (!text) return { text: "말씀해 주시면 바로 맞춰 드릴게요.", chips: EXAMPLES };
  if (last) {
    const follow = followUp(text, ctx, last);
    if (follow) return follow;
  }

  if (/^(안녕|하이|반가|ㅎㅇ)/.test(text)) return { text: "안녕하세요. 오늘 초과 있으세요? 시간만 말해 주시면 칸을 셈해 드릴게요.", chips: EXAMPLES };
  if (/고마|감사|땡큐|ㄱㅅ/.test(text)) return { text: "천만에요. 칸마다 제가 옆에서 챙길게요." };
  if (/알림|알람/.test(text) && /켜|on|받/.test(text) && !QUESTION.test(text)) {
    return { text: "알림을 켤까요? 남긴 날의 [확인] 칸마다 알려 드릴게요.", proposal: { alarm: true }, yes: "네, 켜 주세요" };
  }
  const day = ctx.date ?? ctx.today;
  const now = ctx.spans.map((r) => `${r.from}~${r.to}`).join(", ");
  // 「바꿀래」: 지금 넣어 둔 것을 알려 주고 새 시간을 묻는다. 시각을 함께 말했으면 아래에서 그대로 읽는다.
  if (/바꿀|바꾸|바꿔|수정|고칠|고치|고쳐|변경/.test(text) && !/\d|자정|정오/.test(text) && !/오전|오후|저녁|아침|밤|새벽/.test(text) && !readDate(text, ctx.today).date) {
    return {
      text: now
        ? `좋아요. 지금 ${dayLabel(day)}${ctx.saved ? "에 남긴" : ""} 초과는 ${now}로 되어 있어요. 어떻게 바꿀까요?`
        : `좋아요. ${dayLabel(day)} 초과를 어떻게 넣을까요?`,
      sub: "새 시간을 그대로 말해 주세요. 자리 비운 때도 함께 말하면 같이 넣어요.",
      chips: ["6시~10시", "7시에 저녁 30분", ...(ctx.saved ? ["이 날 빼 줘"] : [])],
    };
  }
  // 「초과 끝」 · 「오늘 끝났어」: 오늘 남은 칸 알림을 멈춘다. 「끝」만 물으면(「언제 끝나요?」) 아래 질문으로 간다.
  if (/(초과|오늘)\s*(은|는)?\s*(끝|종료)|끝났|끝낼|끝내|퇴근했|퇴근할게|그만\s*할/.test(text) && !/\d/.test(text) && !QUESTION.test(text)) {
    if (!ctx.saved || (ctx.date ?? ctx.today) !== ctx.today) return { text: "오늘 남긴 초과가 없어요. 끝낼 것이 없어요." };
    return { text: "오늘 초과를 여기서 끝낼까요?", sub: "남은 칸 알림은 멈추고, 내일 확인자료 차례만 알려 드려요.", proposal: { end: true }, yes: "네, 끝내 주세요" };
  }
  // 「출근 전 지워」 · 「오후 칸 지워 줘」: 사전신청만 걸리고 안 남은 칸을 한 번에 지운다.
  if (/지워|지우|빼\s*줘|빼\s*주세요|안\s*했|안\s*남았/.test(text) && !/\d/.test(text) && !kindOf(text)) {
    const half = /오전|아침|새벽|출근\s*전/.test(text) ? "am" : /오후|저녁|밤|퇴근\s*후/.test(text) ? "pm" : null;
    if (half) return ctx.saved ? cutReply(half, ctx) : { text: `${dayLabel(ctx.date ?? ctx.today)}은 아직 남기지 않은 날이에요. 지울 칸이 없어요.` };
  }
  if (/빼\s*줘|빼\s*주세요|지워|삭제|안\s*남|취소해/.test(text) && !/\d/.test(text) && !kindOf(text)) {
    if (!ctx.saved) return { text: `${dayLabel(day)}은 아직 남기지 않은 날이에요. 뺄 것이 없어요.` };
    return { text: `${dayLabel(day)}에 남긴 초과를 뺄까요?`, sub: "그날 알림도 같이 멈춰요.", proposal: { drop: true }, yes: "네, 빼 주세요" };
  }
  if (/남겨|저장|기록해|등록해/.test(text) && !/\d/.test(text)) {
    if (!ctx.date) return { text: "어느 날을 남길까요? 날짜부터 골라 주세요.", chips: ["오늘", "내일"] };
    return { text: `${dayLabel(ctx.date)} 초과로 남길까요?`, proposal: { keep: true }, yes: "네, 남겨 주세요" };
  }

  const { date, rest } = readDate(text, ctx.today);
  const holidayWord = /휴일|공휴일|주말|쉬는\s*날|빨간\s*날/.test(rest) ? true : /평일/.test(rest) ? false : undefined;
  const target = date ?? ctx.date ?? ctx.today;
  const holiday = holidayWord ?? (date ? isHoliday(date) : ctx.holiday);
  const base = ctx.base;
  const baseFrom = parseHhmm(base.from) ?? 9 * HOUR;
  const baseTo = parseHhmm(base.to) ?? 18 * HOUR;

  // 오늘을 말하는 중이고 지금 시각을 알면, 오전 · 오후 없는 토막을 지금 시각으로 고른다.
  const soon = target === ctx.today && ctx.nowMinute !== undefined;
  const spans: Range[] = [];
  const gaps: Array<Range & { kind: GapKind }> = [];
  let newBase: Range | null = null;
  let timeSeen = false;
  /** 아침으로도 저녁으로도 말이 되는 토막(오늘이 아닌 평일). 저녁으로 넣어 두고, 끝에서 되묻는다. */
  let unsure: { index: number; am: Range } | null = null;

  for (const clause of clauses(rest)) {
    const kind = kindOf(clause);
    const morning = /출근\s*전|아침|새벽|오전/.test(clause);
    const ps = points(clause);
    const dur = duration(clause);
    if (ps.length === 0 && dur === null) continue;
    timeSeen = true;

    let range: Range | null = null;
    if (ps.length >= 2) {
      let from = settle(ps[0], morning, holiday || kind === "base");
      let to = settle(ps[1], morning, holiday || kind === "base");
      if (kind === "base" && ps[0].bare && ps[1].bare) {
        from = ps[0].minute;
        to = ps[1].minute <= from ? ps[1].minute + 12 * HOUR : ps[1].minute;
      } else if (soon && ps[0].bare && ps[1].bare && ps[0].minute < ps[1].minute && !morning) {
        // 오늘, 오전 · 오후 없이 「6시~9시」: 지금 시각으로 고른다. 오전 토막이 아직 안 끝났으면 오전, 지났으면 저녁.
        const am = (ctx.nowMinute as number) < ps[1].minute;
        from = am ? ps[0].minute : ps[0].minute + 12 * HOUR;
        to = am ? ps[1].minute : ps[1].minute + 12 * HOUR;
      } else if (
        !soon &&
        !holiday &&
        kind === null &&
        !morning &&
        unsure === null &&
        ps[0].bare &&
        ps[1].bare &&
        ps[0].minute < ps[1].minute &&
        ps[1].minute <= baseFrom
      ) {
        // 오늘이 아닌 평일의 「6시~9시」: 아침(출근 전에 끝남)으로도 저녁으로도 말이 된다. 지금 시각으로 짐작하지 않고 묻는다.
        unsure = { index: spans.length, am: { from: ps[0].minute, to: ps[1].minute } };
        from = ps[0].minute + 12 * HOUR;
        to = ps[1].minute + 12 * HOUR;
      }
      if (to <= from && to + 12 * HOUR <= 24 * HOUR && !ps[1].fixed) to += 12 * HOUR;
      if (to > from) range = { from, to };
    } else if (ps.length === 1) {
      const p = ps[0];
      const after = clause.slice(p.end);
      const until = /^\s*(까지|전까지)/.test(after);
      const at = settle(p, morning, holiday);
      if (until && kind === null) {
        const from = morning ? null : holiday ? 9 * HOUR : baseTo;
        if (from !== null && at > from) range = { from, to: at };
      } else if (dur !== null) {
        range = { from: at, to: Math.min(24 * HOUR, at + dur) };
      } else if (kind !== null && kind !== "base") {
        range = { from: at, to: Math.min(24 * HOUR, at + HOUR) };
      } else if (/부터/.test(after) || kind === null) {
        // 「6시부터」만 말하면 신청 끝을 모른다. 퇴근 쪽이면 21시까지로 둔다.
        if (!holiday && at >= baseTo && at < 21 * HOUR) range = { from: at, to: 21 * HOUR };
      }
    } else if (dur !== null && kind === null) {
      // 「퇴근하고 3시간」 · 「3시간 남아요」: 퇴근부터. 출근 전이면 출근까지.
      range = morning ? { from: Math.max(0, baseFrom - dur), to: baseFrom } : { from: holiday ? 9 * HOUR : baseTo, to: Math.min(24 * HOUR, (holiday ? 9 * HOUR : baseTo) + dur) };
    }

    if (!range) continue;
    if (kind === "base") newBase = range;
    else if (kind) gaps.push({ ...range, kind });
    else spans.push(range);
  }

  const asked = QUESTION.test(text);
  if (asked && spans.length === 0 && gaps.length === 0 && !newBase) return answer(text);

  if (!timeSeen && date === null && holidayWord === undefined) {
    if (asked || text.length >= 4) return answer(text);
    return { text: "제가 아직 그 말은 못 알아들어요. 이렇게 말해 주세요.", chips: EXAMPLES };
  }
  if (timeSeen && spans.length === 0 && gaps.length === 0 && !newBase) {
    return { text: "시각은 봤는데 어디에 넣을지 모르겠어요. 「6시부터 9시까지」처럼 처음과 끝을 말해 주세요.", chips: EXAMPLES };
  }

  const proposal: Proposal = {};
  if (date) proposal.date = date;
  if (holidayWord !== undefined || (date && isHoliday(date) !== ctx.holiday)) proposal.holiday = holiday;
  if (newBase) proposal.base = { from: hhmm(newBase.from), to: hhmm(newBase.to) };
  if (spans.length > 0) proposal.spans = spans.map((r) => ({ from: hhmm(r.from), to: hhmm(r.to) }));
  if (gaps.length > 0) {
    const fresh = gaps.map((g) => ({ kind: g.kind, from: hhmm(g.from), to: hhmm(g.to) }));
    // 토막을 새로 말했으면 비운 때도 새로, 비운 때만 말했으면 지금 것에 더한다.
    proposal.gaps = spans.length > 0 || date ? fresh : [...ctx.gaps, ...fresh];
  } else if (spans.length > 0) {
    proposal.gaps = [];
  }
  if (unsure && proposal.spans) {
    const at = unsure.index;
    const am: Proposal = { ...proposal, spans: proposal.spans.map((r, i) => (i === at ? { from: hhmm(unsure!.am.from), to: hhmm(unsure!.am.to) } : r)) };
    const pmSpan = proposal.spans[at];
    const amSpan = am.spans![at];
    return {
      text: `${dayLabel(target)} 아침 ${amSpan.from}~${amSpan.to}일까요, 저녁 ${pmSpan.from}~${pmSpan.to}일까요?`,
      sub: "오전 · 오후를 같이 말해 주시면 다음부터는 바로 넣을게요.",
      choices: [
        { label: `아침 ${amSpan.from}~${amSpan.to}`, reply: describe(am, target, holiday, ctx) },
        { label: `저녁 ${pmSpan.from}~${pmSpan.to}`, reply: describe(proposal, target, holiday, ctx) },
      ],
    };
  }
  return describe(proposal, target, holiday, ctx);
}

/**
 * 직전 제안에 이어 한 말. 맥락은 **바로 앞 제안 하나**만 본다.
 *   「응」 · 「ㅇㅇ」 · 「좋아」          → 넣는다
 *   「아니」 · 「ㄴㄴ」 (그것만)          → 넣지 않는다
 *   「오후로」 · 「ㄴㄴ 오후」 · 「no 오후」 → 직전 토막을 오후로(오전은 반대)
 *   「내일로」 · 「모레로」 · 「10/9로」    → 직전 제안의 날만 바꾼다
 * 그 밖의 말이면 null(새 말로 읽는다).
 */
function followUp(text: string, ctx: ChatContext, last: Proposal): Reply | null {
  const bare = text.replace(/[.!~]+$/g, "").trim();
  if (/^(응|ㅇㅇ|ㅇ|네|넵|넹|예|좋아|좋아요|그래|그래요|맞아|맞아요|오케이|ok|okay|yes|ㄱㄱ|넣어|넣어\s*줘|넣어\s*주세요)$/i.test(bare)) {
    return { text: "", accept: true };
  }
  if (/^(아니|아니요|아뇨|ㄴㄴ|ㄴ|노|no|싫어|취소)$/i.test(bare)) return { text: "", reject: true };

  const words = bare.replace(/^(ㄴㄴ|ㄴ|아니|아니요|아뇨|no|노|그게\s*아니라)[\s,]*/i, "");
  const flip = /^(오전|아침|새벽|오후|저녁|밤)\s*(으로|로)?\s*(요|해\s*줘|해\s*주세요|이야|임|요\.?)?$/i.exec(words);
  if (flip) {
    const pm = /오후|저녁|밤/.test(flip[1]);
    if (last.cut) return cutReply(pm ? "pm" : "am", ctx);
    const move = (r: TextRange): TextRange => {
      const from = parseHhmm(r.from) ?? 0;
      const to = parseHhmm(r.to) ?? 0;
      if (pm && to <= 12 * HOUR) return { from: hhmm(from + 12 * HOUR), to: hhmm(Math.min(24 * HOUR, to + 12 * HOUR)) };
      if (!pm && from >= 12 * HOUR) return { from: hhmm(from - 12 * HOUR), to: hhmm(to - 12 * HOUR) };
      return r;
    };
    const next: Proposal = { ...last };
    if (last.spans && last.spans.length > 0) next.spans = last.spans.map(move);
    else if (last.gaps && last.gaps.length > 0) next.gaps = last.gaps.map((g) => ({ ...g, ...move(g) }));
    else return null;
    const date = next.date ?? ctx.date ?? ctx.today;
    return describe(next, date, next.holiday ?? ctx.holiday, ctx);
  }

  const { date, rest } = readDate(words, ctx.today);
  if (date && /^\s*(으로|로|요|로요|으로요|로\s*해\s*줘|로\s*바꿔\s*줘)?\s*$/.test(rest)) {
    const next: Proposal = { ...last, date };
    // 날이 바뀌면 휴일도 그날을 따른다. 직전에 사람이 휴일 · 평일을 말했으면 그대로.
    if (last.holiday === undefined || (last.date && last.holiday === isHoliday(last.date))) next.holiday = isHoliday(date);
    return describe(next, date, next.holiday ?? ctx.holiday, ctx);
  }
  return null;
}

/** 제안을 말로. 칸 수는 `plan.ts` 로 미리 셈한다. */
function describe(p: Proposal, date: string, holiday: boolean, ctx: ChatContext): Reply {
  const parts: string[] = [];
  const holidayName = holidayLabel(date);
  const head = p.date || p.holiday !== undefined ? `${dayLabel(date)}${holiday ? ` 휴일근무${holidayName ? `(${holidayName})` : ""}` : p.holiday === false ? " 평일" : ""}` : "";
  if (p.base) parts.push(`내 근무 ${p.base.from}~${p.base.to}`);
  if (p.spans) parts.push(`초과 ${p.spans.map((r) => `${r.from}~${r.to}`).join(", ")}`);
  const added = p.gaps ? p.gaps.slice(p.spans || p.date ? 0 : ctx.gaps.length) : [];
  for (const g of added) parts.push(`${KIND_WORD[g.kind]} ${g.from}~${g.to}`);

  const spans = (p.spans ?? ctx.spans).map(toRange).filter((r): r is Range => r !== null);
  const gaps = (p.gaps ?? ctx.gaps).flatMap((g) => {
    const r = toRange(g);
    return r ? [{ ...r, kind: g.kind }] : [];
  });
  const base = toRange(p.base ?? ctx.base) ?? { from: 9 * HOUR, to: 18 * HOUR };
  const plan = planDay({ holiday, base, spans, gaps });
  const clicks = plan.slots.filter((s) => s.action === "click").length;
  const reasons = plan.slots.length - clicks;
  const sub =
    plan.slots.length > 0
      ? `그러면 ${plan.slots.length}칸이에요. [확인] ${clicks}칸, 사유 ${reasons}칸.`
      : p.spans || spans.length > 0
        ? "그 시간은 기록 칸이 없어요. 근무시간 안쪽인지 봐 주세요."
        : "초과 시간도 말해 주시면 칸을 셈해 드릴게요.";
  const what = parts.join(", ");
  // 이미 남긴 날을 고치는 것이면 「바꿀까요?」, 휴일 · 날짜만이면 「할까요?」, 그 밖은 「넣을까요?」.
  const change = ctx.saved === true && !p.date;
  const text = what ? `${head ? `${head} ` : ""}${what}로 ${change ? "바꿀까요?" : "넣을까요?"}` : `${head}로 할까요?`;
  const yes = what ? (change ? "네, 바꿔 주세요" : "네, 넣어 주세요") : "네, 그렇게 해 주세요";
  return { text, sub, proposal: p, yes };
}

/** 오전(출근 전) · 오후(퇴근 후) 칸 지우기 제안. 평일은 「출근 전 · 퇴근 후」, 휴일은 「오전 · 오후」라고 부른다. */
function cutReply(half: "am" | "pm", ctx: ChatContext): Reply {
  const name = ctx.holiday ? (half === "am" ? "오전" : "오후") : half === "am" ? "출근 전" : "퇴근 후";
  return {
    text: `${dayLabel(ctx.date ?? ctx.today)} ${name} 칸을 지울까요?`,
    sub: "사전신청만 걸리고 안 남은 칸으로 남겨요. 알림도 멈추고, 다음 날 사유 쓸 칸에서 빠져요.",
    proposal: { cut: half },
    yes: "네, 지워 주세요",
  };
}

function toRange(r: TextRange): Range | null {
  const from = parseHhmm(r.from);
  const to = parseHhmm(r.to);
  return from !== null && to !== null && to > from ? { from, to } : null;
}

// ── 묻고 답하기 ────────────────────────────────────────────

/** 같은 뜻으로 묶어 찾는 말. 왼쪽 말이 나오면 오른쪽 말로도 찾는다. */
const SAME: Array<[RegExp, string[]]> = [
  [/밥|식사|저녁|점심/, ["식사"]],
  [/알람|알림|팝업/, ["알림"]],
  [/버튼|누르|눌러|클릭/, ["[확인]", "누르"]],
  [/주말|토요일|일요일|휴일|공휴일/, ["휴일", "주말", "토요일"]],
  [/올려|상신|확인자료|결재/, ["확인자료", "올립"]],
  [/사유|이유|못\s*눌/, ["사유"]],
  [/외출|개인/, ["외출"]],
  [/현장|외근/, ["현장"]],
  [/지문|출근|퇴근/, ["지문", "퇴근확인"]],
  [/유연/, ["유연근무"]],
  [/상한|최대|한도/, ["상한"]],
  [/반려|돌려/, ["반려"]],
  [/부정|걸리|적발/, ["부정"]],
  [/분\s*단위|몇\s*분|1시간\s*미만|빠지|공제/, ["분 단위", "1시간", "빼"]],
  [/대상|누가/, ["대상"]],
  [/정각/, ["정각"]],
  [/한꺼번|몰아|여러/, ["한꺼번"]],
  [/고칠|수정/, ["고칠"]],
];

const STRIP = /(인가요|하나요|되나요|했나요|나요|까요|가요|해요|돼요|되요|에서|으로|하고|이랑|에는|은|는|이|가|을|를|에|도|요|만|로|의|랑)$/;

/** 묻고 답하기 자료에서 맞는 답을 찾는다. 많이 맞는 것부터 셋까지. */
export function searchFaq(text: string): Faq[] {
  const words = new Set<string>();
  for (const raw of text.split(/[^가-힣A-Za-z0-9[\]]+/)) {
    const w = raw.replace(STRIP, "");
    if (w.length >= 2) words.add(w);
  }
  for (const [re, extra] of SAME) if (re.test(text)) for (const e of extra) words.add(e);
  const scored = FAQ.map((f, i) => {
    let score = 0;
    for (const w of words) {
      if (f.q.includes(w)) score += 3;
      else if (f.a.includes(w)) score += 1;
      if (f.group.includes(w)) score += 1;
    }
    return { f, i, score };
  })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, 3).map((x) => x.f);
}

/** 질문에 답한다. 자료에 없으면 없다고 한다. 지어내지 않는다. */
export function answer(text: string): Reply {
  const hits = searchFaq(text);
  if (hits.length === 0) {
    return {
      text: "그건 제가 가진 자료에 없어요. 기관 복무 담당에게 물어보시는 게 가장 정확해요.",
      sub: "초과 시간을 넣으시려면 「오늘 6시부터 9시까지」처럼 말해 주세요.",
      chips: QUESTION_EXAMPLES,
    };
  }
  const [top, ...more] = hits;
  return {
    text: top.a,
    sub: `「${top.q}」 · 출처 ${top.from}${top.ref ? ` ${top.ref}` : ""}`,
    chips: more.map((f) => f.q),
  };
}

// ── 순서 ────────────────────────────────────────────────

/** 하루 순서. 순서 탭의 PJ 가 한 걸음씩 말한다. */
export const STEPS = [
  "초과근무 신청(사전 또는 사후)은 기존과 같아요.",
  "브라우저에서 인사랑 팝업 차단을 풀어 두세요. 로그인이 끊기면 알림이 안 뜨니 알림만 믿지 않아요.",
  "초과 시간에는 한 시간 칸마다 [근무기록] → [확인]을 한 번 눌러요. 칸은 정각 기준이고 19:00 정각은 19~20 칸이에요.",
  "인사랑 알림은 매시 30분쯤 떠요(사람마다 조금씩 달라요). 휴일 09:00~18:00에는 알림이 없으니 직접 눌러요.",
  "퇴근확인에서 한 일을 적어요. 빠뜨리면 기존처럼 인정되지 않아요.",
  "못 누른 칸(식사, 외출, 현장, 로그인 전)은 미기록 사유를 써요. 외출은 근무제외시간에도 넣고, 식사는 넣지 않아요.",
  "다음 날 초과근무 확인자료를 날짜별로 한 건씩 올려요. 근무기록은 여기에 함께 붙어 가요.",
  "반려되면 상세 화면 [근무기록조회]에서 재검토 사항을 보고, 사유나 제외시간을 고쳐 다시 올려요.",
];

/** 순서 탭에서 친 말. 「다음」 · 「처음」 · 숫자는 걸음을 옮기고, 그 밖은 묻고 답하기로 답한다. */
export function stepReply(message: string, at: number): { at: number; reply: Reply | null } {
  const text = message.trim();
  if (/^(다음|넥스트|ㄱ|응|네|오케이|ok)$/i.test(text)) return { at: Math.min(STEPS.length - 1, at + 1), reply: null };
  if (/^(이전|전|뒤로|앞)$/.test(text)) return { at: Math.max(0, at - 1), reply: null };
  if (/처음/.test(text)) return { at: 0, reply: null };
  const n = /^(\d)\s*(번|단계)?$/.exec(text);
  if (n && Number(n[1]) >= 1 && Number(n[1]) <= STEPS.length) return { at: Number(n[1]) - 1, reply: null };
  return { at, reply: answer(text) };
}

/** 순서의 한 걸음을 말로. */
export function stepLine(at: number): Reply {
  return {
    text: `${at + 1}/${STEPS.length}. ${STEPS[at]}`,
    sub: at === STEPS.length - 1 ? "여기까지가 하루 순서예요. 궁금한 건 아래에 물어보세요." : undefined,
  };
}
