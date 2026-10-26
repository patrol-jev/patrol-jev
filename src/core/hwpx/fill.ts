import { strToU8, zipSync } from "fflate";
import type { FormMap } from "../form-map";
import type { SlotKey } from "../form-slots";
import type { IljiSlots } from "../ilji-slots";
import { docFromEntries, openHwpx, type CellRef, type HwpxDoc } from "./read";
import { esc } from "./xml";

/**
 * 부서 양식에 **채우기**. 칸 지도(FormMap)가 가리키는 셀에 글과 사진을 넣는다.
 *
 * 양식의 나머지는 한 글자도 안 건드린다. 셀 안 첫 문단의 모양(문단·글자 번호)을 그대로 이어받아
 * 줄마다 문단 하나로 다시 쓴다. 그래야 그 부서의 글꼴·크기·정렬이 유지된다.
 *
 * 줄 배치 캐시(linesegarray)는 **전부 지운다.** 내용이 바뀐 문단에 옛 캐시가 남으면 한글이 열지
 * 않는다. 어느 문단을 고쳤든 마지막에 한 번에 걷어 낸다.
 *
 * 그림 이름은 **양식에 이미 든 그림과 겹치지 않게** 짓는다. 채운 파일을 다시 양식으로 올리는 날이 있다
 * (09-26 실물). 그때 같은 이름을 또 쓰면 옛 그림이 새 그림을 덮어 사진 칸이 빈 채로 나온다.
 *
 * 주간 산출(`fillFormWeek`)은 같은 양식을 날짜 수만큼 이어 붙인 뒤 날마다 채운다. 셋(하루 2쪽)이
 * 날짜 차례로 붙고, 사이는 쪽 나눔이다. 기재가 없는 날은 빈 셋을 넣지 않는다.
 *
 * 이 파일은 브라우저에서 돈다. 사진은 여기서 파일에 들어가고 서버로 가지 않는다.
 */

export interface FillResult {
  bytes: Uint8Array;
  /** 못 채운 자리. 지도에 없거나 셀을 못 찾은 것. */
  skipped: SlotKey[];
  photosPlaced: number;
  /** 넘겨받은 사진 자리 수(날짜 전부 합). 양식의 사진 칸보다 많으면 뒤의 것은 못 실었다. */
  photosOffered: number;
  /** 양식에 있는 사진 자리 수(한 날 몫). */
  photoSlots: number;
}

export function fillForm(formBytes: Uint8Array, map: FormMap, slots: IljiSlots): FillResult {
  return fillDoc(openHwpx(formBytes), map, [slots]);
}

/**
 * 주간. 양식 본문을 `days.length` 번 이어 붙이고(사이는 쪽 나눔), k 번째 사본의 표 번호는
 * `k × (양식의 표 수)` 만큼 밀려 있으므로 지도도 그만큼 밀어 채운다.
 */
export function fillFormWeek(formBytes: Uint8Array, map: FormMap, days: IljiSlots[]): FillResult {
  const doc = openHwpx(formBytes);
  if (days.length <= 1) return fillDoc(doc, map, days);
  return fillDoc(replicateSections(doc, days.length), map, days);
}

function fillDoc(opened: HwpxDoc, map: FormMap, days: IljiSlots[]): FillResult {
  let doc = opened;
  const skipped: SlotKey[] = [];
  const tablesPerCopy = countTables(opened, days.length);

  // 그림 이름. 양식에 이미 든 이름(목록·BinData)을 피하고, 끝 숫자도 겹치지 않게 잇는다(`imageNamer`).
  const nextImageId = imageNamer(takenImageIds(doc), "pjimg");

  const binaries: Array<{ id: string; path: string; bytes: Uint8Array }> = [];
  let header = doc.header;
  let placed = 0;
  let offered = 0;

  days.forEach((slots, k) => {
    const shift = (r: CellRef): CellRef => ({ ...r, tbl: r.tbl + k * tablesPerCopy });
    const values: Record<SlotKey, string[]> = {
      dateLabel: [slots.dateLabel.trim()].filter(Boolean),
      officer: [slots.officer.trim()].filter(Boolean),
      area: [slots.area.trim()].filter(Boolean),
      seasonal: slots.rows.seasonal,
      facility: slots.rows.facility,
      community: slots.rows.community,
      patrol: slots.rows.patrol,
      etc: slots.rows.etc,
    };

    // 글. 셀을 하나 고칠 때마다 오프셋이 바뀌므로 매번 다시 읽는다. 문서가 작아 값싸다.
    for (const slot of Object.keys(values) as SlotKey[]) {
      const target = map.text[slot];
      if (!target) {
        if (values[slot].length > 0 && !skipped.includes(slot)) skipped.push(slot);
        continue;
      }
      const written = writeCell(doc, shift(target), values[slot]);
      if (!written) {
        if (!skipped.includes(slot)) skipped.push(slot);
        continue;
      }
      doc = reopen(doc, written);
    }

    // 사진. 그림 채움 테두리를 header 끝에 이어 붙이고, 셀이 그 번호를 가리키게 한다.
    const captions = new Map<string, string[]>();
    const place = (cell: CellRef, bytes: Uint8Array): boolean => {
      const found = findCell(doc, cell);
      if (!found) return false;
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
      return true;
    };
    offered += slots.photos.length;
    map.photos.forEach((slot, i) => {
      const photo = slots.photos[i];
      if (!photo) return;
      if (slot.cells.length >= 2) {
        // 전·후 두 칸. 왼쪽이 전, 오른쪽이 후.
        if (photo.before) place(shift(slot.cells[0]), photo.before);
        if (photo.after) place(shift(slot.cells[1]), photo.after);
      } else if (slot.cells.length === 1) {
        // 한 칸이면 후를 우선. 치운 뒤가 증거다.
        const one = photo.after ?? photo.before;
        if (one) place(shift(slot.cells[0]), one);
      }
      if (slot.caption && photo.caption) {
        const key = refKey(shift(slot.caption));
        captions.set(key, [...(captions.get(key) ?? []), photo.caption]);
      }
    });
    for (const [key, texts] of captions) {
      const [sec, tbl, row, col] = key.split(":").map(Number);
      const written = writeCell(doc, { sec, tbl, row, col }, [texts.join("   |   ")]);
      if (written) doc = reopen(doc, written);
    }
  });

  // 캐시 걷어 내기. 마지막에 한 번, 구역 전부.
  const sections = doc.sections.map((xml) => xml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, ""));

  // 꾸러미 목록에 사진 항목을 더한다. 같은 id 가 두 번 적힌 목록(옛 판이 만든 파일)은 하나로 줄인다.
  let hpf = dedupeManifest(doc.hpf);
  if (binaries.length > 0) {
    const items = binaries
      .map((b) => `<opf:item id="${b.id}" href="${b.path}" media-type="image/jpeg" isEmbeded="1"/>`)
      .join("");
    hpf = hpf.includes("<opf:manifest>")
      ? hpf.replace("<opf:manifest>", `<opf:manifest>${items}`)
      : hpf.replace(/<opf:manifest[^>]*>/, (m) => m + items);
  }

  return {
    bytes: repack(doc, sections, header, hpf, binaries),
    skipped,
    photosPlaced: placed,
    photosOffered: offered,
    photoSlots: map.photos.length,
  };
}

/** 목록에 같은 id 항목이 둘 이상이면 첫 것만 남긴다. 한글은 겹친 항목을 보면 그림을 못 찾는다. */
export function dedupeManifest(hpf: string): string {
  const seen = new Set<string>();
  return hpf.replace(/<opf:item [^>]*id="([^"]+)"[^>]*\/>/g, (item, id: string) => {
    if (seen.has(id)) return "";
    seen.add(id);
    return item;
  });
}

/** 양식 한 벌의 표 수. 이어 붙인 문서면 사본 수로 나눈 값. */
function countTables(doc: HwpxDoc, copies: number): number {
  return Math.floor(doc.tables.length / Math.max(1, copies));
}

/**
 * 새 그림 이름을 짓는 함수. 이미 든 이름은 물론 **이름 끝의 숫자**도 겹치지 않게 한다.
 * 한글 뷰어 가운데 그림을 이름이 아니라 끝 숫자로 찾는 것이 있다(10-19 실물, 폰 뷰어). 양식의 `image1` 옆에
 * `pjimg1` 을 넣으면 둘이 같은 그림으로 읽혀 사진 칸에 엉뚱한 그림이 든다.
 */
export function imageNamer(taken: Set<string>, prefix: string): () => string {
  const used = new Set<number>();
  for (const name of taken) {
    const m = /(\d+)$/.exec(name);
    if (m) used.add(Number(m[1]));
  }
  let n = 0;
  return () => {
    do n += 1;
    while (used.has(n) || taken.has(`${prefix}${n}`));
    used.add(n);
    return `${prefix}${n}`;
  };
}

/** 양식이 이미 쓰고 있는 그림 이름. 목록(manifest)의 id 와 BinData 파일 이름 둘 다 본다. */
export function takenImageIds(doc: HwpxDoc): Set<string> {
  const ids = new Set<string>();
  for (const m of doc.hpf.matchAll(/<opf:item [^>]*id="([^"]+)"/g)) ids.add(m[1]);
  for (const name of Object.keys(doc.entries)) {
    if (name.startsWith("BinData/")) ids.add(name.slice("BinData/".length).replace(/\.[^.]+$/, ""));
  }
  for (const m of doc.header.matchAll(/binaryItemIDRef="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

/**
 * 구역 본문을 n 번 이어 붙인다. 첫 문단의 구역 설정(secPr·colPr)은 첫 사본에만 남기고,
 * 사본마다 첫 문단은 쪽 나눔으로 시작한다. 표·그림의 id 와 zOrder 는 사본마다 밀어 겹치지 않게 한다.
 */
function replicateSections(doc: HwpxDoc, copies: number): HwpxDoc {
  const entries = { ...doc.entries };
  doc.sectionNames.forEach((name, i) => {
    const xml = doc.sections[i];
    const open = /<hs:sec[^>]*>/.exec(xml);
    const closeAt = xml.lastIndexOf("</hs:sec>");
    if (!open || closeAt < 0) return;
    const head = xml.slice(0, open.index + open[0].length);
    const body = xml.slice(open.index + open[0].length, closeAt);
    const tail = xml.slice(closeAt);

    const stripped = body
      .replace(/<hp:secPr[\s\S]*?<\/hp:secPr>/, "")
      .replace(/<hp:ctrl><hp:colPr[\s\S]*?<\/hp:colPr><\/hp:ctrl>/, "")
      .replace(/<hp:ctrl><hp:colPr[^>]*\/><\/hp:ctrl>/, "");
    const parts: string[] = [body];
    for (let k = 1; k < copies; k++) {
      let copy = stripped.replace(/<hp:p ([^>]*)pageBreak="0"/, (_, before) => `<hp:p ${before}pageBreak="1"`);
      const bump = k * 100000;
      copy = copy.replace(
        /<hp:(tbl|pic|container|line|rect|ellipse|arc|polygon|curve|connectLine|textart|ole|equation) ([^>]*)id="(\d+)"([^>]*)zOrder="(\d+)"/g,
        (_, tagName, a, id, b, z) => `<hp:${tagName} ${a}id="${Number(id) + bump}"${b}zOrder="${Number(z) + bump}"`,
      );
      parts.push(copy);
    }
    entries[name] = strToU8(head + parts.join("") + tail);
  });
  return docFromEntries(entries);
}

function refKey(r: CellRef): string {
  return `${r.sec}:${r.tbl}:${r.row}:${r.col}`;
}

export function findCell(doc: HwpxDoc, ref: CellRef) {
  const table = doc.tables.find((t) => t.sec === ref.sec && t.tbl === ref.tbl);
  return table?.cells.find((c) => c.row === ref.row && c.col === ref.col) ?? null;
}

/**
 * 셀 내용을 줄 배열로 바꾼 구역 XML. 셀 안에 표가 있으면 안 건드린다(null).
 * 첫 문단의 여는 태그와, 글자가 든 첫 run 의 글자 번호를 이어받는다. 앞에 공백만 든 run 이 붙어
 * 있는 양식이 있어서, 그 run 의 번호를 쓰면 글꼴이 바뀐다.
 */
export function writeCell(doc: HwpxDoc, ref: CellRef, lines: string[]): { sections: string[]; header?: string } | null {
  const cell = findCell(doc, ref);
  if (!cell) return null;
  const xml = doc.sections[cell.sec];
  const chunk = xml.slice(cell.start, cell.end);
  if (chunk.includes("<hp:tbl ")) return null;

  const subOpen = /<hp:subList [^>]*>/.exec(chunk);
  const subClose = chunk.lastIndexOf("</hp:subList>");
  if (!subOpen || subClose < 0) return null;
  const contentStart = subOpen.index + subOpen[0].length;
  const content = chunk.slice(contentStart, subClose);

  const pOpen = /<hp:p [^>]*>/.exec(content)?.[0] ?? '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">';
  const charPr = firstTextCharPr(content);
  const paras =
    lines.length === 0
      ? `${pOpen}<hp:run charPrIDRef="${charPr}"/></hp:p>`
      : lines.map((line) => `${pOpen}<hp:run charPrIDRef="${charPr}"><hp:t>${esc(line)}</hp:t></hp:run></hp:p>`).join("");

  const next = chunk.slice(0, contentStart) + paras + chunk.slice(subClose);
  const sections = [...doc.sections];
  sections[cell.sec] = xml.slice(0, cell.start) + next + xml.slice(cell.end);
  return { sections };
}

function firstTextCharPr(content: string): string {
  let firstAny: string | null = null;
  const re = /<hp:run\s+[^>]*charPrIDRef="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/hp:run>)/g;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (firstAny === null) firstAny = m[1];
    const text = [...(m[2] ?? "").matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)].map((t) => t[1].replace(/<[^>]+>/g, "")).join("");
    if (text.trim()) return m[1];
  }
  return firstAny ?? "0";
}

/**
 * 사진 칸의 테두리를 복제해 그림 채움을 얹은 새 테두리를 목록 **끝에** 붙인다.
 * 번호는 마지막 번호 + 1. 중간에 끼우면 뒤 번호가 전부 밀린다.
 */
export function appendImageFill(header: string, baseFillId: number, imageId: string): { header: string; id: number } {
  const ids = [...header.matchAll(/<hh:borderFill id="(\d+)"/g)].map((m) => Number(m[1]));
  const id = (ids.length > 0 ? Math.max(...ids) : 0) + 1;
  const baseRe = new RegExp(`<hh:borderFill id="${baseFillId}"[\\s\\S]*?</hh:borderFill>`);
  const base = baseRe.exec(header)?.[0] ?? fallbackFill();
  let clone = base.replace(/<hh:borderFill id="\d+"/, `<hh:borderFill id="${id}"`).replace(/<hc:fillBrush>[\s\S]*?<\/hc:fillBrush>/, "");
  const brush = `<hc:fillBrush><hc:imgBrush mode="TOTAL"><hc:img binaryItemIDRef="${imageId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/></hc:imgBrush></hc:fillBrush>`;
  clone = clone.replace("</hh:borderFill>", `${brush}</hh:borderFill>`);
  const count = /<hh:borderFills itemCnt="(\d+)"/.exec(header);
  let next = header.replace("</hh:borderFills>", `${clone}</hh:borderFills>`);
  if (count) next = next.replace(count[0], `<hh:borderFills itemCnt="${Number(count[1]) + 1}"`);
  return { header: next, id };
}

function fallbackFill(): string {
  const side = (s: string) => `<hh:${s}Border type="SOLID" width="0.12 mm" color="#000000"/>`;
  return (
    '<hh:borderFill id="0" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">' +
    '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
    side("left") + side("right") + side("top") + side("bottom") +
    '<hh:diagonal type="NONE" width="0.1 mm" color="none"/></hh:borderFill>'
  );
}

export function reopen(doc: HwpxDoc, next: { sections: string[]; header?: string }): HwpxDoc {
  const entries = { ...doc.entries };
  next.sections.forEach((xml, i) => {
    entries[doc.sectionNames[i]] = strToU8(xml);
  });
  if (next.header) entries["Contents/header.xml"] = strToU8(next.header);
  return docFromEntries(entries);
}

/**
 * 원래 차례 그대로 다시 싼다. mimetype 은 맨 앞에 압축 없이. 사진은 version.xml 뒤에 끼운다.
 * 새 그림이 양식의 항목과 같은 경로면 **새 것이 이긴다.** 이름은 이미 겹치지 않게 지었지만, 한 번 더 막는다.
 */
export function repack(
  doc: HwpxDoc,
  sections: string[],
  header: string,
  hpf: string,
  binaries: Array<{ path: string; bytes: Uint8Array }>,
): Uint8Array {
  const out: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const replaced: Record<string, Uint8Array> = { "Contents/header.xml": strToU8(header), "Contents/content.hpf": strToU8(hpf) };
  sections.forEach((xml, i) => {
    replaced[doc.sectionNames[i]] = strToU8(xml);
  });
  for (const b of binaries) replaced[b.path] = b.bytes;
  const names = Object.keys(doc.entries);
  const ordered = names.includes("mimetype") ? ["mimetype", ...names.filter((n) => n !== "mimetype")] : names;
  for (const name of ordered) {
    const bytes = replaced[name] ?? doc.entries[name];
    const stored = name === "mimetype" || name === "version.xml" || name.startsWith("BinData/");
    out[name] = [bytes, { level: stored ? 0 : 6 }];
    if (name === "version.xml") for (const b of binaries) if (!out[b.path]) out[b.path] = [b.bytes, { level: 0 }];
  }
  for (const b of binaries) if (!out[b.path]) out[b.path] = [b.bytes, { level: 0 }];
  return zipSync(out);
}
