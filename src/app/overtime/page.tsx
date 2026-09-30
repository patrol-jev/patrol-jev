import type { Metadata } from "next";
import OvertimeApp from "./overtime-app";

// 서버에서 읽는 것이 없다. 설정도 키도 쓰지 않는 한 장짜리 화면이다.
// 홈 화면에 얹으면 순찰일지가 아니라 이 화면으로 열리도록 매니페스트를 따로 둔다(아이폰 알림은 홈 화면에서만 된다).
export const metadata: Metadata = {
  title: "초과기록",
  description: "오늘 초과 시간을 넣으면 인사랑에서 누를 칸과 쓸 사유가 나옵니다.",
  manifest: "/overtime.webmanifest",
  appleWebApp: { capable: true, title: "초과기록", statusBarStyle: "default" },
};

export default function Page() {
  return <OvertimeApp />;
}
