/**
 * 오늘 날짜, **한국 시각으로**.
 *
 * ⚠ `toISOString()` 은 세계 표준시라 그대로 쓰면 날이 바뀌는 시각이 **아침 아홉 시**가 된다.
 * 아홉 시간을 먼저 더하고 나서 날짜만 떼면 한국의 자정에 넘어간다.
 * 구역 천장 · 견본 기간 · 맛보기 한도가 전부 이 하루를 쓴다. 자리마다 다르게 세지 않는다.
 */
export function todayInKorea(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}
