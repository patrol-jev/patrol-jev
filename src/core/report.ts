import type { Group } from "./types";

/**
 * 일지 문장은 **코드가 만든다**. 생성 모델에게 글을 맡기지 않는다.
 *
 * 그래야 같은 판정에서 늘 같은 문장이 나오고, 틀린 문장이 나오면 고칠 자리가 한 군데다.
 * 모델이 하는 일은 「어느 란에 넣을지」와 「주소판에 뭐라고 적혀 있는지」까지다.
 *
 * 이 도구는 여기까지만 한다. 부서 양식은 동마다 다르다.
 */

export interface ReportBlock {
  key: "waste_cleanup" | "flood_season" | "risk_facility";
  title: string;
  text: string;
  /** 이 란에 들어간 묶음 수. 0이면 화면에 흐리게 둔다. */
  count: number;
}

/**
 * 일지에 나가는 말. **전부 여기 있다.**
 *
 * 사람이 보고서에서 문구를 고치면 그 값이 이 자리에 얹힌다. 그래서 부서마다 쓰는 말이
 * 달라도 코드를 고칠 일이 없다.
 */
export interface Wording {
  /** 순찰사항 묶음 제목. */
  patrolHeading: string;
  /** 순찰사항 자리마다 붙는 말. 건마다 달리 적지 않는다. */
  patrolWork: string;
  /** 위험시설물 제목. */
  facilityHeading: string;
  /** 위험시설물 자리마다 붙는 말. */
  facilityWork: string;
  /** 계절특수 고정 점검 제목. */
  shadeHeading: string;
  /** 계절특수 배수 건에 붙는 말. */
  drainWork: string;
  /** 계절특수 그늘막 건에 붙는 말. 캡션에 그늘막이 있으면 배수 말 대신 이것. */
  shadeWork: string;
}

export const DEFAULT_WORDING: Wording = {
  patrolHeading: "이면도로 청소 및 도로변 정비",
  patrolWork: "폐기물 처리 및 수거",
  facilityHeading: "위험건축물 점검",
  facilityWork: "현장 확인",
  shadeHeading: "스마트그늘막 등 점검",
  drainWork: "배수구 주변 폐기물 처리 및 수거",
  shadeWork: "스마트그늘막 점검",
};

export interface ReportInput {
  dong: string;
  /** YYYY-MM-DD */
  date: string;
  groups: Group[];
  seasonalSpots: string[];
  /** 사람이 고친 문구. 안 주면 기본값. */
  wording?: Partial<Wording>;
}

export interface Report {
  header: string;
  blocks: ReportBlock[];
  /** 머리글 + 세 란을 이은 전체 본문. */
  full: string;
  /** 갈래가 안 정해진 묶음 수. 0이 아니면 화면이 먼저 알린다. */
  undecided: number;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 줄 머리. 받은 부서 양식의 들여쓰기를 그대로 옮긴 것이라 마음대로 바꾸지 않는다. */
const H1 = "  ○ ";
const H2 = "    - ";
const H3 = "      · ";
/** 위험시설물·계절특수의 소항목은 한 칸 덜 들어간다. 양식이 그렇다. */
const H3_TIGHT = "     · ";

export function buildReport(input: ReportInput): Report {
  const say: Wording = { ...DEFAULT_WORDING, ...input.wording };

  const stamps = input.groups.map((g) => g.time).filter(Boolean).sort();
  const span = stamps.length > 0 ? ` (${stamps[0]}~${stamps[stamps.length - 1]})` : "";

  const header = [
    `${input.dong} 현장 점검 일지 (${input.date})`,
    "",
    "□ 순찰개요",
    ` ○ 순찰일시: ${formatDate(input.date)}${span}`,
    ` ○ 순찰구역: ${input.dong} 관내 전지역`,
  ].join("\n");

  const blocks: ReportBlock[] = [
    waste(input.groups, say),
    facility(input.groups, say),
    seasonal(input.groups, input.seasonalSpots, say),
  ];

  // 특이사항 줄은 안 낸다. 적을 것이 있으면 사람이 「※ 특이사항: …」 를 덧붙이고, 그 줄은 양식의 특이사항 칸으로 간다.
  const full = [header, ...blocks.map((b) => b.text)].join("\n\n");

  return {
    header,
    blocks,
    full,
    undecided: input.groups.filter((g) => g.lane === "unknown").length,
  };
}

/**
 * 순찰사항.
 *
 *   □ 순찰사항
 *     ○ 이면도로 청소 및 도로변 정비
 *       - {첫 자리} 외 N개소
 *         · {자리} 폐기물 처리 및 수거
 */
function waste(groups: Group[], say: Wording): ReportBlock {
  const mine = groups.filter((g) => g.lane === "waste_cleanup");
  const lines = ["□ 순찰사항"];

  if (mine.length === 0) {
    lines.push(`${H1}해당 없음`);
    return { key: "waste_cleanup", title: "순찰사항", text: lines.join("\n"), count: 0 };
  }

  const withAddress = mine.filter((g) => g.address.trim().length > 0);
  const unnamed = mine.length - withAddress.length;

  lines.push(`${H1}${say.patrolHeading}`);

  // 자리마다 적을 말. 그 자리에 따로 정해 둔 말이 있으면 그것을 쓴다.
  const workOf = (group: Group) => group.work?.trim() || say.patrolWork;

  // 한 곳뿐이면 한 줄로 끝낸다. 같은 주소를 두 줄에 적는 늘리기는 하지 않는다.
  if (mine.length === 1 && withAddress.length === 1) {
    lines.push(`${H2}${withAddress[0].address.trim()} ${workOf(withAddress[0])}`);
  } else if (withAddress.length === 0) {
    // 주소를 하나도 모르면 개소 수만 적는다. 지어낸 주소보다 빈칸이 낫다.
    lines.push(`${H2}주소 미기재 ${mine.length}개소 ${say.patrolWork}`);
  } else {
    lines.push(`${H2}${withAddress[0].address.trim()} 외 ${mine.length - 1}개소`);
    for (const group of withAddress) {
      lines.push(`${H3}${group.address.trim()} ${workOf(group)}`);
    }
    // 주소를 모르는 자리도 지우지 않고 몇 곳인지 적는다.
    if (unnamed > 0) lines.push(`${H3}주소 미기재 ${unnamed}개소 ${say.patrolWork}`);
  }

  return { key: "waste_cleanup", title: "순찰사항", text: lines.join("\n"), count: mine.length };
}

/**
 * 위험시설물.
 *
 *   □ 위험시설물 순찰사항
 *     ○ 위험건축물 점검
 *       - 현장확인: N건, 특이사항: 없음
 *        · {자리} 현장 확인
 *          ※
 *            →
 *
 * 자리에 적을 말을 쉼표로 나눠 적으면 차례로 · 줄, ※ 줄, → 줄에 들어간다.
 * 「도로 파손 확인, 스마트불편신고(접수번호: …), 기 조치 요청한 곳으로 경과 관찰」 처럼.
 * 쉼표가 없으면 · 줄에만 들어가고 ※ · → 는 비워 둔다. 그 칸은 사람이 채운다.
 */
function facility(groups: Group[], say: Wording): ReportBlock {
  const mine = groups.filter((g) => g.lane === "risk_facility");
  const lines = ["□ 위험시설물 순찰사항"];

  if (mine.length === 0) {
    lines.push(`${H1}해당 없음`);
    return { key: "risk_facility", title: "위험시설물", text: lines.join("\n"), count: 0 };
  }

  lines.push(`${H1}${say.facilityHeading}`);
  lines.push(`${H2}현장확인: ${mine.length}건, 특이사항: 없음`);

  for (const group of mine) {
    const address = group.address.trim();
    const parts = splitWork(group.work?.trim() || say.facilityWork);
    lines.push(`${H3_TIGHT}${address || "주소 미기재"} ${parts[0]}`);
    // 통보와 회신 자리. 쉼표로 나눠 적은 말이 있으면 그것을, 없으면 비워 두고 사람이 채운다.
    lines.push(`       ※ ${parts[1] ?? ""}`);
    if (parts.length <= 2) lines.push("         → ");
    for (const rest of parts.slice(2)) lines.push(`         → ${rest}`);
  }

  return { key: "risk_facility", title: "위험시설물", text: lines.join("\n"), count: mine.length };
}

/**
 * 계절특수.
 *
 *   □ 계절특수 순찰사항
 *     ○ 스마트그늘막 등 점검        ← 자리가 고정이라 설정의 목록을 그대로 적는다
 *       - 현장확인: N건 , 특이사항: 없음
 *        · {고정 지점}
 *     ○ {자리} 배수구 주변 폐기물 처리 및 수거
 *     ○ {자리} 스마트그늘막 점검            ← 캡션에 그늘막이 있던 자리(group.shade)
 */
function seasonal(groups: Group[], spots: string[], say: Wording): ReportBlock {
  const mine = groups.filter((g) => g.lane === "flood_season");
  const lines = ["□ 계절특수 순찰사항"];

  if (mine.length === 0 && spots.length === 0) {
    lines.push(`${H1}해당 없음`);
    return { key: "flood_season", title: "계절특수", text: lines.join("\n"), count: 0 };
  }

  if (spots.length > 0) {
    lines.push(`${H1}${say.shadeHeading}`);
    lines.push(`${H2}현장확인: ${spots.length}건 , 특이사항: 없음`);
    for (const spot of spots) lines.push(`${H3_TIGHT}${spot}`);
  }

  for (const group of mine) {
    const address = group.address.trim();
    const work = group.work?.trim() || (group.shade ? say.shadeWork : say.drainWork);
    lines.push(`${H1}${address ? `${address} ` : ""}${work}`);
  }

  return { key: "flood_season", title: "계절특수", text: lines.join("\n"), count: mine.length };
}

/** 쉼표로 나눈 말. 괄호 안의 쉼표는 나누지 않는다(「신고(접수번호: 1, 2)」). 빈 조각은 버린다. */
export function splitWork(work: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of work) {
    if (ch === "(" || ch === "（") depth += 1;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  const trimmed = parts.map((one) => one.trim()).filter((one) => one.length > 0);
  return trimmed.length > 0 ? trimmed : [work.trim()];
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const day = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}. ${m}. ${d}.(${day})`;
}

/**
 * 사람이 고친 글에서 **문구만** 뽑아낸다.
 *
 * 보고서에서 글을 고치면 그 회차만 바뀌고 끝나는 게 아니라, 다음에도 그 말로 적히게 한다.
 * 다만 배우는 것은 **말**이지 **틀**이 아니다. 줄 수가 달라지면(줄을 넣거나 지웠으면)
 * 어느 자리가 어느 자리인지 알 수 없으므로 아무것도 배우지 않는다. 잘못 배우느니 안 배운다.
 *
 * 주소·건수처럼 그날의 값은 배우지 않는다. 바뀐 줄에서 **그 값을 뺀 나머지**만 본다.
 */
export function learnWording(generated: string, edited: string, current: Wording): Partial<Wording> {
  const before = generated.split("\n");
  const after = edited.split("\n");
  if (before.length !== after.length) return {};

  const learned: Partial<Wording> = {};

  const heading = (key: keyof Wording) => ({ head: `${H1}${current[key]}`, key });
  const headings = [heading("patrolHeading"), heading("facilityHeading"), heading("shadeHeading")];

  for (const [i, old] of before.entries()) {
    const now = after[i];
    if (old === now || now.trim().length === 0) continue;

    // ① 제목 줄. 줄머리를 뺀 나머지가 통째로 그 말이다.
    const title = headings.find((h) => old === h.head);
    if (title && now.startsWith(H1)) {
      learned[title.key] = now.slice(H1.length).trim();
      continue;
    }

    // ② 자리 줄. 주소는 그날 값이니 건드리지 않고, 뒤에 붙는 말만 가져온다.
    // 순찰사항의 말은 소항목(·)에도, 한 곳뿐일 때의 대표 줄(-)에도 붙는다.
    for (const [key, prefix] of [
      ["patrolWork", H3],
      ["patrolWork", H2],
      ["facilityWork", H3_TIGHT],
      ["drainWork", H1],
      ["shadeWork", H1],
    ] as const) {
      const tail = ` ${current[key]}`;
      if (!old.startsWith(prefix) || !old.endsWith(tail)) continue;

      const address = old.slice(prefix.length, old.length - tail.length);
      if (!now.startsWith(`${prefix}${address} `)) continue;

      const value = now.slice(prefix.length + address.length + 1).trim();
      if (value.length > 0) learned[key] = value;
      break;
    }
  }

  return learned;
}
