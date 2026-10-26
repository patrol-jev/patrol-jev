import { unzipSync, strFromU8 } from "fflate";

/**
 * 남이 만든 hwpx 를 **읽는** 쪽. 표와 셀의 자리·크기·글자를 뽑는다.
 *
 * XML 파서를 쓰지 않고 문자열을 훑는다. 한글이 저장한 XML 은 개행 없는 한 줄이고, 우리가 필요한
 * 것은 표·셀의 위치와 글자뿐이다. 파서로 트리를 만들었다가 다시 문자열로 쓰면 한글이 안 읽는
 * 미세한 차이(속성 차례·자기 닫힘 꼴)가 생긴다. 원문은 그대로 두고 자리만 찾는다.
 *
 * 이 파일은 서버(칸 지도 만들기)와 브라우저(채우기) 양쪽에서 돈다.
 */

export interface CellRef {
  /** 몇 번째 구역 파일(section0, section1 …). */
  sec: number;
  /** 그 구역 안에서 몇 번째 표(문서 차례, 중첩 표 포함). */
  tbl: number;
  row: number;
  col: number;
}

export interface CellInfo extends CellRef {
  colSpan: number;
  rowSpan: number;
  width: number;
  height: number;
  /** 셀 안 글자. 문단은 줄바꿈으로 잇는다. 중첩 표의 글자는 뺀다. */
  text: string;
  fill: number;
  /** 셀 배경이 그림인가(header 의 테두리 목록에서 본다). */
  hasImage: boolean;
  /** `<hp:tc` 시작과 `</hp:tc>` 끝. 구역 XML 안의 오프셋. */
  start: number;
  end: number;
}

export interface TableInfo {
  sec: number;
  tbl: number;
  rows: number;
  cols: number;
  width: number;
  start: number;
  end: number;
  cells: CellInfo[];
}

export interface HwpxDoc {
  /** 꾸러미 안 파일 전부, 원래 차례 그대로. */
  entries: Record<string, Uint8Array>;
  /** 구역 파일 이름들, 번호 차례. */
  sectionNames: string[];
  sections: string[];
  header: string;
  hpf: string;
  tables: TableInfo[];
}

export function openHwpx(bytes: Uint8Array): HwpxDoc {
  return docFromEntries(unzipSync(bytes));
}

/** 이미 풀어 둔 항목들로. 채우기가 셀을 고칠 때마다 다시 읽는 데 쓴다(zip 을 다시 싸지 않는다). */
export function docFromEntries(entries: Record<string, Uint8Array>): HwpxDoc {
  const sectionNames = Object.keys(entries)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort((a, b) => sectionNo(a) - sectionNo(b));
  if (sectionNames.length === 0) throw new Error("hwpx 안에 본문(section)이 없습니다.");
  const header = entries["Contents/header.xml"] ? strFromU8(entries["Contents/header.xml"]) : "";
  const hpf = entries["Contents/content.hpf"] ? strFromU8(entries["Contents/content.hpf"]) : "";
  const sections = sectionNames.map((name) => strFromU8(entries[name]));
  const imageFills = imageFillIds(header);
  const tables = sections.flatMap((xml, sec) => parseTables(xml, sec, imageFills));
  return { entries, sectionNames, sections, header, hpf, tables };
}

function sectionNo(name: string): number {
  return Number(/section(\d+)/.exec(name)?.[1] ?? 0);
}

/** 그림 채움을 가진 테두리 번호들. */
export function imageFillIds(header: string): Set<number> {
  const ids = new Set<number>();
  const re = /<hh:borderFill id="(\d+)"[\s\S]*?<\/hh:borderFill>/g;
  for (let m = re.exec(header); m; m = re.exec(header)) {
    if (m[0].includes("<hc:imgBrush")) ids.add(Number(m[1]));
  }
  return ids;
}

/** `<hp:tbl` 이 시작하는 자리에서 짝이 맞는 `</hp:tbl>` 끝까지. */
export function tableSpan(xml: string, start: number): number {
  const re = /<hp:tbl[ >]|<\/hp:tbl>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
    } else depth += 1;
  }
  throw new Error("hwpx 표 짝이 맞지 않습니다.");
}

export function parseTables(xml: string, sec: number, imageFills: Set<number>): TableInfo[] {
  const tables: TableInfo[] = [];
  const re = /<hp:tbl [^>]*>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const start = m.index;
    const end = tableSpan(xml, start);
    const open = m[0];
    const table: TableInfo = {
      sec,
      tbl: tables.length,
      rows: Number(/rowCnt="(\d+)"/.exec(open)?.[1] ?? 0),
      cols: Number(/colCnt="(\d+)"/.exec(open)?.[1] ?? 0),
      width: Number(/<hp:sz width="(\d+)"/.exec(xml.slice(start, start + 600))?.[1] ?? 0),
      start,
      end,
      cells: [],
    };
    table.cells = parseCells(xml, table, imageFills);
    tables.push(table);
  }
  return tables;
}

/** 표 바로 아래 층의 셀만. 중첩 표의 셀은 그 표의 몫이다. */
function parseCells(xml: string, table: TableInfo, imageFills: Set<number>): CellInfo[] {
  const cells: CellInfo[] = [];
  const re = /<hp:tc[ >]|<\/hp:tc>|<hp:tbl[ >]|<\/hp:tbl>/g;
  re.lastIndex = table.start + 1;
  let tableDepth = 0;
  let cellStart = -1;
  for (let m = re.exec(xml); m && m.index < table.end; m = re.exec(xml)) {
    const token = m[0];
    if (token.startsWith("<hp:tbl")) tableDepth += 1;
    else if (token === "</hp:tbl>") tableDepth -= 1;
    else if (tableDepth === 0 && token.startsWith("<hp:tc")) cellStart = m.index;
    else if (tableDepth === 0 && token === "</hp:tc>" && cellStart >= 0) {
      const end = m.index + token.length;
      cells.push(readCell(xml, cellStart, end, table, imageFills));
      cellStart = -1;
    }
  }
  return cells;
}

function readCell(xml: string, start: number, end: number, table: TableInfo, imageFills: Set<number>): CellInfo {
  const chunk = xml.slice(start, end);
  const open = /<hp:tc [^>]*>/.exec(chunk)?.[0] ?? "";
  const fill = Number(/borderFillIDRef="(\d+)"/.exec(open)?.[1] ?? 0);
  const addr = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/.exec(chunk);
  const span = /<hp:cellSpan colSpan="(\d+)" rowSpan="(\d+)"\/>/.exec(chunk);
  const size = /<hp:cellSz width="(\d+)" height="(\d+)"\/>/.exec(chunk);
  return {
    sec: table.sec,
    tbl: table.tbl,
    row: Number(addr?.[2] ?? 0),
    col: Number(addr?.[1] ?? 0),
    colSpan: Number(span?.[1] ?? 1),
    rowSpan: Number(span?.[2] ?? 1),
    width: Number(size?.[1] ?? 0),
    height: Number(size?.[2] ?? 0),
    text: cellText(chunk),
    fill,
    hasImage: imageFills.has(fill),
    start,
    end,
  };
}

/** 중첩 표를 걷어 낸 셀 글자. 문단마다 한 줄. */
export function cellText(chunk: string): string {
  const own = stripNestedTables(chunk);
  const lines: string[] = [];
  const paraRe = /<hp:p [^>]*>([\s\S]*?)<\/hp:p>/g;
  for (let m = paraRe.exec(own); m; m = paraRe.exec(own)) {
    const runs = [...m[1].matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)].map((t) =>
      t[1].replace(/<hp:lineBreak\s*\/>/g, "\n").replace(/<[^>]+>/g, ""),
    );
    const text = unescape(runs.join(""));
    if (text.trim().length > 0) lines.push(text.trim());
  }
  return lines.join("\n");
}

/** 조각 안의 표를 통째로 지운다(글자 세기용). */
export function stripNestedTables(chunk: string): string {
  let out = chunk;
  for (let at = out.indexOf("<hp:tbl "); at >= 0; at = out.indexOf("<hp:tbl ")) {
    const end = tableSpan(out, at);
    out = out.slice(0, at) + out.slice(end);
  }
  return out;
}

function unescape(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 라벨 견주기용. 자간 벌림(「순 찰 자」)·괄호 안·기호를 걷어 낸다. */
export function normalizeLabel(text: string): string {
  return text
    .replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/[\s□■▪○●◦ㅇ·•※:：\-–_.,/|「」『』【】\[\]<>《》〈〉"'*]/g, "")
    .trim();
}
