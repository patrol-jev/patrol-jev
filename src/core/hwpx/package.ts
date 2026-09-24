import { strToU8, zipSync } from "fflate";
import { NAMESPACES, XML_HEAD, esc } from "./xml";

/**
 * hwpx 꾸러미(zip). 파일 차례와 압축 여부까지 한글이 저장하는 그대로 맞춘다.
 *
 * `mimetype` 이 **첫 항목이고 압축하지 않는다.** 그래야 파일 앞머리만 읽는 프로그램이
 * 이것을 hwpx 로 알아본다. 그림은 이미 JPEG 라 다시 압축하지 않는다.
 */

export interface Binary {
  /** 본문이 가리키는 이름. `img1` 처럼 짧게. */
  id: string;
  /** 꾸러미 안 경로. `BinData/img1.jpg`. */
  path: string;
  bytes: Uint8Array;
}

export interface Package {
  header: string;
  section: string;
  binaries: Binary[];
  title: string;
}

const MIMETYPE = "application/hwp+zip";

const VERSION =
  XML_HEAD +
  '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR"' +
  ' major="5" minor="0" micro="5" buildNumber="0" os="1" xmlVersion="1.4" application="Hancom Office Hangul" appVersion="9, 1, 1, 5656 PolarisOffice_"/>';

const CONTAINER =
  XML_HEAD +
  '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf">' +
  '<ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>';

const MANIFEST = XML_HEAD + '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>';

const SETTINGS =
  XML_HEAD +
  '<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">' +
  '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>';

function contentHpf(pkg: Package, when: Date): string {
  const items =
    pkg.binaries
      .map((b) => `<opf:item id="${esc(b.id)}" href="${esc(b.path)}" media-type="image/jpeg" isEmbeded="1"/>`)
      .join("") +
    '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>' +
    '<opf:item id="settings" href="settings.xml" media-type="application/xml"/>' +
    '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>';
  const stamp = when.toISOString().replace(/\.\d{3}Z$/, "Z");
  return (
    XML_HEAD +
    `<opf:package${NAMESPACES} version="" unique-identifier="" id="">` +
    "<opf:metadata>" +
    `<opf:title>${esc(pkg.title)}</opf:title>` +
    "<opf:language>ko</opf:language>" +
    '<opf:meta name="creator" content="text">patrol-jev</opf:meta>' +
    '<opf:meta name="subject" content="text"/>' +
    '<opf:meta name="description" content="text"/>' +
    '<opf:meta name="lastsaveby" content="text">patrol-jev</opf:meta>' +
    `<opf:meta name="CreatedDate" content="text">${stamp}</opf:meta>` +
    `<opf:meta name="ModifiedDate" content="text">${stamp}</opf:meta>` +
    '<opf:meta name="keyword" content="text"/>' +
    "</opf:metadata>" +
    `<opf:manifest>${items}</opf:manifest>` +
    '<opf:spine><opf:itemref idref="header"/><opf:itemref idref="section0" linear="yes"/></opf:spine>' +
    "</opf:package>"
  );
}

/** 꾸러미를 바이트로. 브라우저에서도 노드에서도 같은 코드다. */
export function packHwpx(pkg: Package, when = new Date()): Uint8Array {
  // 객체의 키 차례가 곧 zip 안 차례다. mimetype 이 맨 앞이어야 한다.
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    mimetype: [strToU8(MIMETYPE), { level: 0 }],
    "version.xml": [strToU8(VERSION), { level: 0 }],
    "META-INF/container.xml": [strToU8(CONTAINER), { level: 6 }],
    "settings.xml": [strToU8(SETTINGS), { level: 6 }],
  };
  for (const b of pkg.binaries) entries[b.path] = [b.bytes, { level: 0 }];
  entries["Contents/header.xml"] = [strToU8(pkg.header), { level: 6 }];
  entries["Contents/section0.xml"] = [strToU8(pkg.section), { level: 6 }];
  entries["Contents/content.hpf"] = [strToU8(contentHpf(pkg, when)), { level: 6 }];
  entries["META-INF/manifest.xml"] = [strToU8(MANIFEST), { level: 6 }];
  return zipSync(entries);
}
