import { strToU8 } from "fflate";
import type { PeriodFormMap, SpotTable } from "../period-form-map";
import { CATEGORY_ROWS, longDate, shortDate, type PeriodSummary } from "../period";
import { appendImageFill, dedupeManifest, findCell, imageNamer, reopen, repack, takenImageIds, writeCell } from "./fill";
import type { PeriodPhoto } from "./period";
import { docFromEntries, openHwpx, type CellRef, type HwpxDoc } from "./read";

/**
 * 결과 보고서 **부서 양식에 채우기**. 칸 지도(`PeriodFormMap`)가 가리키는 칸에 집계와 사진을 넣는다.
 *
 * 일지 채우기(`fill.ts`)와 같은 원칙이다. 양식의 나머지는 안 건드리고, 셀 첫 문단의 모양을 이어받아 다시 쓴다.
 * 다른 점은 **자리 표 복제**다. 양식에는 자리 표가 넷인데 한 주에 자리가 열이면, 마지막 자리 표가 든 문단을
 * 모자란 수만큼 그 뒤에 복제한다(표 id·zOrder 는 밀어 겹치지 않게). 복제는 채우기 전에 한 번만 하고, 그 뒤
 * 표 번호는 문서 차례대로 다시 읽는다. 자리 표 뒤의 표(현안보고)는 어차피 안 채우니 밀려도 상관없다.
 *
 * 표 밖의 머리 줄 둘도 채운다. 「순찰기간 :」 줄은 날짜 자리가 빈 틀일 때만 기간으로 바꾸고, 「보고자 :」 줄은
 * 「성명」 뒤에 담당자 이름을 잇는다(직급은 이 도구가 모른다). 이미 적혀 있으면 건드리지 않는다.
 *
 * 항목표는 **셀 수 있는 줄만** 숫자를 적고 나머지는 양식에 있던 그대로 둔다. 0 과 빈 칸은 다른 뜻이다.
 *
 * 이 파일은 브라우저에서 돈다. 사진은 여기서 파일에 들어가고 서버로 가지 않는다.
 */

export interface PeriodFormInput {
  dong: string;
  /** 담당자 이름. 「보고자」 줄의 성명 뒤에 잇는다. 없으면 그 줄은 그대로 둔다. */
  officer?: string;
  summary: PeriodSummary;
  /** 자리 사진. `date` 와 `no` 로 세부내역 줄과 맞춘다. 이미 양식의 사진 칸 비율로 잘라 둔 것. */
  photos: PeriodPhoto[];
}

export interface PeriodFillResult {
  bytes: Uint8Array;
  photosPlaced: number;
  /** 세부내역 자리 수(양식 표 수보다 많으면 복제했다). */
  spotsOffered: number;
  /** 정비요청 세부내역 가운데 표 줄이 모자라 못 실은 건수. */
  requestsDropped: number;
  /** 못 채운 것. 지도에 없던 자리. */
  skipped: string[];
}

export function fillPeriodForm(formBytes: Uint8Array, map: PeriodFormMap, input: PeriodFormInput): PeriodFillResult {
  const s = input.summary;
  const skipped = [...map.missing];
  const details = s.details;

  // ── 자리 표 복제. 지도의 마지막 자리 표를 본보기로.
  let doc = openHwpx(formBytes);
  let spots: SpotTable[] = map.spots;
  if (details.length > map.spots.length && map.spots.length > 0) {
    const template = map.spots[map.spots.length - 1];
    const copies = details.length - map.spots.length;
    doc = replicateSpotTable(doc, template, copies);
    spots = [...map.spots, ...Array.from({ length: copies }, (_, k) => shiftSpot(template, k + 1))];
  }

  const nextImageId = imageNamer(takenImageIds(doc), "pjimg");
  const binaries: Array<{ id: string; path: string; bytes: Uint8Array }> = [];
  let header = doc.header;
  let placed = 0;

  const write = (cell: CellRef | null | undefined, lines: string[], name: string): void => {
    if (!cell) {
      if (lines.some((l) => l.trim()) && !skipped.includes(name)) skipped.push(name);
      return;
    }
    const written = writeCell(doc, cell, lines);
    if (!written) {
      if (!skipped.includes(name)) skipped.push(name);
      return;
    }
    doc = reopen(doc, written);
  };
  const place = (cell: CellRef | null, bytes: Uint8Array | null): void => {
    if (!cell || !bytes) return;
    const found = findCell(doc, cell);
    if (!found) return;
    const id = nextImageId();
    binaries.push({ id, path: `BinData/${id}.jpg`, bytes });
    const added = appendImageFill(header, found.fill, id);
    header = added.header;
    const sections = [...doc.sections];
    const xml = sections[found.sec];
    const open = /<hp:tc [^>]*>/.exec(xml.slice(found.start, found.end))?.[0] ?? "";
    const replaced = open.replace(/borderFillIDRef="\d+"/, `borderFillIDRef="${added.id}"`);
    sections[found.sec] = xml.slice(0, found.start) + replaced + xml.slice(found.start + open.length);
    doc = reopen(doc, { sections, header });
    placed += 1;
  };

  // ── 제목. 「○○동」 앞은 기간으로, 뒤 꼬리는 그대로.
  if (map.title) {
    const text = map.title.text;
    const at = text.indexOf("○○동");
    const tail = at >= 0 ? text.slice(at + 3) : " 환경순찰 결과 보고서";
    const dong = input.dong.trim() || s.dong.trim() || "○○동";
    write(map.title.cell, [`${s.period.name} ${dong}${tail}`.replace(/\s+/g, " ").trim()], "제목");
  }

  // ── 총계
  write(map.totals.total, [String(s.requested + s.self)], "총계");
  write(map.totals.requested, [String(s.requested)], "총계 정비요청");
  write(map.totals.self, [String(s.self)], "총계 자체정비");

  // ── 항목표. 셀 수 있는 줄만.
  s.categories.forEach((line, index) => {
    const cells = map.categories[index];
    if (!cells) return;
    if (line.requested !== null) write(cells.requested, [String(line.requested)], `항목표 ${CATEGORY_ROWS[index]?.item ?? index}`);
    if (line.self !== null) write(cells.self, [String(line.self)], `항목표 ${CATEGORY_ROWS[index]?.item ?? index}`);
  });

  // ── 정비요청 세부내역
  let requestsDropped = 0;
  if (map.requests) {
    const r = map.requests;
    const col = (name: keyof typeof r.cols): number | undefined => r.cols[name];
    s.requests.forEach((line, i) => {
      if (i >= r.rows) {
        requestsDropped += 1;
        return;
      }
      const row = r.firstRow + i;
      const at = (c: number | undefined): CellRef | null => (c === undefined ? null : { sec: r.sec, tbl: r.tbl, row, col: c });
      write(at(col("no")), [String(line.no)], "정비요청 연번");
      write(at(col("group")), [line.group], "정비요청 구분");
      write(at(col("address")), [line.address], "정비요청 위치");
      write(at(col("text")), [line.text], "정비요청 요청내역");
    });
  } else if (s.requests.length > 0) requestsDropped = s.requests.length;

  // ── 자리 표
  const photoOf = (date: string, no: number) => input.photos.find((p) => p.date === date && p.no === no) ?? null;
  details.forEach((line, i) => {
    const spot = spots[i];
    if (!spot) return;
    write(spot.no, [String(line.no)], "자리 연번");
    write(spot.address, [line.address || "주소 미기재"], "자리 위치");
    write(spot.work, [line.work], "자리 정비내역");
    const photo = photoOf(line.date, line.no);
    if (photo) {
      place(spot.before, photo.before);
      place(spot.after, photo.after);
    }
  });

  const head = fillHeadLines(doc.sections, s, input.officer ?? "");
  for (const name of head.missed) if (!skipped.includes(name)) skipped.push(name);
  const sections = head.sections.map((xml) => xml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, ""));
  let hpf = dedupeManifest(doc.hpf);
  if (binaries.length > 0) {
    const items = binaries.map((b) => `<opf:item id="${b.id}" href="${b.path}" media-type="image/jpeg" isEmbeded="1"/>`).join("");
    hpf = hpf.includes("<opf:manifest>") ? hpf.replace("<opf:manifest>", `<opf:manifest>${items}`) : hpf.replace(/<opf:manifest[^>]*>/, (m) => m + items);
  }

  return {
    bytes: repack(doc, sections, header, hpf, binaries),
    photosPlaced: placed,
    spotsOffered: details.length,
    requestsDropped,
    skipped,
  };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 표 밖 머리 줄. 한 줄이 글자 조각 하나(`hp:t`)에 통째로 든 양식만 채운다. 조각이 갈라져 있으면 못 채운 것으로 알린다.
 * 줄이 아예 없는 양식은 조용히 지나간다.
 */
function fillHeadLines(sections: string[], s: PeriodSummary, officer: string): { sections: string[]; missed: string[] } {
  const missed: string[] = [];
  const sameYear = s.period.from.slice(0, 4) === s.period.to.slice(0, 4);
  const span = `${longDate(s.period.from)} ~ ${sameYear ? shortDate(s.period.to) : longDate(s.period.to)}`;
  const name = officer.trim();
  let periodSeen = false;
  let periodDone = false;
  let reporterSeen = false;
  let reporterDone = false;
  const out = sections.map((xml) =>
    xml.replace(/<hp:t>([^<]*)<\/hp:t>/g, (whole, text: string) => {
      const period = /^(.*순\s*찰\s*기\s*간\s*[:：])(.*)$/.exec(text);
      if (period) {
        periodSeen = true;
        const tail = period[2];
        // 날짜 자리가 빈 틀(숫자·점·물결뿐이고 온전한 날짜가 없음)일 때만 바꾼다.
        if (/^[\s\d.~∼-]*$/.test(tail) && !/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(tail)) {
          periodDone = true;
          return `<hp:t>${period[1]}  ${span}</hp:t>`;
        }
        if (/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(tail)) periodDone = true;
        return whole;
      }
      const reporter = /^(.*보\s*고\s*자\s*[:：].*성\s*명)\s*$/.exec(text);
      if (reporter) {
        reporterSeen = true;
        if (!name) return whole;
        reporterDone = true;
        return `<hp:t>${reporter[1]} ${escapeXml(name)}</hp:t>`;
      }
      return whole;
    }),
  );
  const hasLine = (word: RegExp) => sections.some((xml) => word.test(xml.replace(/<[^>]+>/g, "")));
  if (!periodDone && (periodSeen || hasLine(/순\s*찰\s*기\s*간\s*[:：]/))) missed.push("순찰기간");
  if (name && !reporterDone && !reporterSeen && hasLine(/보\s*고\s*자\s*[:：]/)) missed.push("보고자");
  return { sections: out, missed };
}

/** 본보기 자리 표의 칸 번호를 k 번째 사본으로 옮긴다. 사본은 본보기 바로 뒤에 차례로 들어간다. */
function shiftSpot(template: SpotTable, k: number): SpotTable {
  const move = (r: CellRef | null): CellRef | null => (r ? { ...r, tbl: r.tbl + k } : null);
  return {
    sec: template.sec,
    tbl: template.tbl + k,
    no: move(template.no),
    address: move(template.address),
    work: move(template.work),
    doc: move(template.doc),
    before: move(template.before),
    after: move(template.after),
  };
}

/**
 * 자리 표가 든 문단을 그 뒤에 `copies` 번 복제한다. 표 id·zOrder 는 사본마다 밀고, 사본의 문단은 쪽 나눔 없이
 * 그대로 이어진다(양식이 표마다 쪽을 나눴으면 그 설정이 문단 안에 있어 같이 복제된다).
 */
function replicateSpotTable(doc: HwpxDoc, template: SpotTable, copies: number): HwpxDoc {
  const table = doc.tables.find((t) => t.sec === template.sec && t.tbl === template.tbl);
  if (!table) return doc;
  const xml = doc.sections[table.sec];
  const pStart = xml.lastIndexOf("<hp:p ", table.start);
  const pEndAt = xml.indexOf("</hp:p>", table.end);
  if (pStart < 0 || pEndAt < 0) return doc;
  const pEnd = pEndAt + "</hp:p>".length;
  const paragraph = xml.slice(pStart, pEnd);
  const clones: string[] = [];
  for (let k = 1; k <= copies; k++) {
    const bump = k * 100000;
    clones.push(
      paragraph.replace(
        /<hp:(tbl|pic|container|line|rect|ellipse|arc|polygon|curve|connectLine|textart|ole|equation) ([^>]*)id="(\d+)"([^>]*)zOrder="(\d+)"/g,
        (_, tagName, a, id, b, z) => `<hp:${tagName} ${a}id="${Number(id) + bump}"${b}zOrder="${Number(z) + bump}"`,
      ),
    );
  }
  const entries = { ...doc.entries };
  entries[doc.sectionNames[table.sec]] = strToU8(xml.slice(0, pEnd) + clones.join("") + xml.slice(pEnd));
  return docFromEntries(entries);
}
