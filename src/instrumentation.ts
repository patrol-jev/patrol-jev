/**
 * 서버가 뜰 때 한 번 불린다.
 *
 * 초과기록 진동 알림은 서버가 때맞춰 보내야 한다. 재기동 뒤 아무도 화면을 열지 않아도
 * 맡아 둔 알림이 울리도록 여기서 시계를 켠다. 키가 없으면 켜지지 않는다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTicker } = await import("./core/overtime/push");
  startTicker();
}
