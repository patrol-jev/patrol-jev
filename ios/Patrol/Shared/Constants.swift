import Foundation

enum Constants {
    static let webURL = "https://patrol.ai.kr"

    /// 앱 안에서 여는 주소. 여기 없는 주소는 사파리로 넘긴다.
    static let internalHosts: Set<String> = ["patrol.ai.kr"]

    static let appGroupID = "group.kr.ai.patrol"

    /// 웹 화면이 하루치 기록을 쌓는 localStorage 열쇠. `src/ui/usage.ts` 의 DAYS 와 같아야 한다.
    static let daysKey = "patrol-jev.days"
}
