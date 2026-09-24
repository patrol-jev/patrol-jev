/**
 * hwpx 는 zip 안에 XML 이 든 꼴이다(OWPML). 여기서는 문자열로 직접 짓는다.
 *
 * 왜 라이브러리 없이 문자열인가. 한글이 여는 파일의 조건은 스펙 문서보다 좁다.
 * 스타일 id 는 목록마다 0 부터 빈틈없이 이어져야 하고(뷰어가 id 를 자리로 읽는다),
 * 줄 배치 캐시(linesegarray)는 내용과 어긋나면 「손상된 문서」가 된다. 그런 조건은
 * 만드는 쪽이 전부 쥐고 있어야 지킬 수 있다. 여기 있는 함수는 그 조건을 코드로 박아 둔다.
 *
 * 이 파일은 브라우저에서도 돈다. 아무것도 import 하지 않는다.
 */

/** XML 글자 이스케이프. 값은 전부 여기를 거친다. 주소에 `&` 가 들어오는 날이 있다. */
export function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 속성 객체를 ` a="1" b="2"` 꼴로. 값은 이스케이프한다. */
export function attrs(values: Record<string, string | number>): string {
  return Object.entries(values)
    .map(([key, value]) => ` ${key}="${esc(String(value))}"`)
    .join("");
}

/** 여는 태그·내용·닫는 태그. 내용이 비면 자기 닫힘 태그. */
export function tag(name: string, values: Record<string, string | number>, inner = ""): string {
  return inner ? `<${name}${attrs(values)}>${inner}</${name}>` : `<${name}${attrs(values)}/>`;
}

/**
 * 모든 hwpx XML 파일 머리에 붙는 이름 공간. 한글이 저장한 파일 그대로다.
 * 안 쓰는 것까지 다 적는다. 빠진 이름 공간이 있으면 어떤 판의 한글은 열지 않는다.
 */
export const NAMESPACES =
  ' xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"' +
  ' xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"' +
  ' xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph"' +
  ' xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"' +
  ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"' +
  ' xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"' +
  ' xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history"' +
  ' xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page"' +
  ' xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"' +
  ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
  ' xmlns:opf="http://www.idpf.org/2007/opf/"' +
  ' xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart"' +
  ' xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"' +
  ' xmlns:epub="http://www.idpf.org/2007/ops"' +
  ' xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** 한글 단위(HWPUNIT). 1pt = 100. A4 세로 = 59528 × 84188. */
export const A4 = { width: 59528, height: 84188 } as const;
/** 좌우 여백 5102 씩 뺀 본문 너비. 표 너비는 이 값을 넘지 않는다. */
export const BODY_WIDTH = A4.width - 5102 * 2;
