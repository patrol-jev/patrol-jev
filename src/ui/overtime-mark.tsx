/**
 * 초과기록의 표식. 사진일지 사진기(`photolog-mark.tsx`)와 같은 몸을 **연보라**로 칠하고, 렌즈 자리에 **시계**를 달았다.
 * 탭 줄의 초과기록 그림(`tab-bar.tsx`)과 같은 빛이다. 눈 둘과 볼, 웃는 입은 렌즈 양옆과 아래에 둔다.
 *
 * 시곗바늘은 지금 한국 시각을 가리킨다(`minute` = 그날의 분). 처음 열리면 한 바퀴 돌아 제자리에 앉는다.
 * 눈은 무대가 넘겨 주는 --look-x/--look-y 를 따라본다. 움직임은 `overtime.css` 의 `ot-*` 만 쓴다.
 * 색은 도구의 이름표일 뿐이다. 파랑([확인])과 주황(사유)의 뜻과 섞이지 않게 몸에만 쓴다.
 */
export const OVERTIME_ACCENT = "#5B7CFA";

const BODY =
  "M10 20c0-3.3 2.7-6 6-6h3.2c1.1 0 2.1-.6 2.6-1.5l1-1.8c.5-.9 1.5-1.5 2.6-1.5h5.2c1.1 0 2.1.6 2.6 1.5l1 1.8c.5.9 1.5 1.5 2.6 1.5H40c3.3 0 6 2.7 6 6v15c0 3.3-2.7 6-6 6H16c-3.3 0-6-2.7-6-6V20Z";

export function OvertimeClockMark({ minute, shot = 0, busy = false }: { minute: number; shot?: number; busy?: boolean }) {
  const h = Math.floor(minute / 60) % 12;
  const m = minute % 60;
  return (
    <span className={`ot-float ${busy ? "ot-busy" : ""}`}>
      <span key={shot} className={`ot-body ${shot > 0 ? "ot-shot" : ""}`}>
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" role="img" aria-label="시계" style={{ color: "var(--ink)", overflow: "visible" }}>
          <path d={BODY} fill={OVERTIME_ACCENT} stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />

          {/* 눈 둘. 흰 빛점이 시선을 따라 조금 움직인다. 가끔 깜빡인다. */}
          <g className="ot-blink">
            <ellipse cx="15.6" cy="25.2" rx="1.9" ry="2.4" fill="#1A1C2E" />
            <ellipse cx="40.4" cy="25.2" rx="1.9" ry="2.4" fill="#1A1C2E" />
            <g className="ot-eye">
              <circle cx="16.2" cy="24.4" r="0.7" fill="#fff" />
              <circle cx="41" cy="24.4" r="0.7" fill="#fff" />
            </g>
          </g>
          <ellipse cx="15.2" cy="30.6" rx="2.4" ry="1.3" fill="#FF9EC0" opacity="0.75" />
          <ellipse cx="40.8" cy="30.6" rx="2.4" ry="1.3" fill="#FF9EC0" opacity="0.75" />

          {/* 렌즈 = 시계. 눈금 넷, 바늘 둘. */}
          <circle cx="28" cy="27" r="9" fill="#fff" stroke="currentColor" strokeWidth="2.4" />
          <path d="M28 19.6v1.6M28 32.8v1.6M20.6 27h1.6M33.8 27h1.6" stroke="#1A1C2E" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
          <g className="ot-hand" style={{ ["--a" as string]: `${h * 30 + m * 0.5}deg` }}>
            <path d="M28 27v-4.4" stroke="#1A1C2E" strokeWidth="2.2" strokeLinecap="round" />
          </g>
          <g className="ot-hand ot-hand-min" style={{ ["--a" as string]: `${m * 6}deg` }}>
            <path d="M28 27v-6.4" stroke={OVERTIME_ACCENT} strokeWidth="1.7" strokeLinecap="round" />
          </g>
          <circle cx="28" cy="27" r="1.3" fill="#1A1C2E" />

          {/* 웃는 입. */}
          <path d="M25.8 38.2c1.3 1.1 3.1 1.1 4.4 0" stroke="#1A1C2E" strokeWidth="1.7" strokeLinecap="round" />

          <circle className="ot-bulb" cx="40" cy="17.6" r="1.5" fill="currentColor" />
          <path className="ot-lines" d="M5.5 16.5 3 13M50.5 16.5 53 13" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </span>
    </span>
  );
}
