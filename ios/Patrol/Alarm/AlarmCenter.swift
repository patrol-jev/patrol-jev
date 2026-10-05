import Foundation
import UIKit
import UserNotifications
import WebKit

/// 초과기록 알림을 이 기기 안에서 울린다.
///
/// 앱 안의 웹 화면에는 웹 푸시가 없다. 그래서 웹 화면(`src/app/overtime/push-client.ts`)이 셈한 「울릴 목록」을
/// `patrolAlarm` 통로로 넘기면, 앱이 그 시각에 기기 알림을 건다. 서버에는 아무것도 맡기지 않는다.
///
/// 넘어오는 것은 울릴 시각, 칸 번호(시), 날짜뿐이다. 근무시간, 사유, 이름은 오지 않는다.
/// 알림 글은 웹 쪽 서버(`src/core/overtime/push.ts` 의 `messageOf`)와 같은 문장을 앱이 직접 만든다.
///
/// 한 앱이 걸어 둘 수 있는 알림은 64건이다. 목록 전체는 기기에 두고 가까운 것부터 `armLimit` 건만 건다.
/// 앱이 앞으로 올 때마다 다시 채운다.
final class AlarmCenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = AlarmCenter()

    /// 걸어 둘 알림 수. 64 한도에서 조금 남긴다.
    static let armLimit = 60
    /// 맡아 둘 목록의 길이. 한 달치 사전신청이 들어와도 넉넉하다.
    static let keepLimit = 400
    /// 얼마나 앞까지 받는가. 한 달치 + 며칠.
    static let aheadLimit: TimeInterval = 40 * 24 * 3600

    private static let prefix = "ot-"
    private static let storeKey = "overtimeAlarms"
    static let openNotification = Notification.Name("patrolOpenURL")

    private let center = UNUserNotificationCenter.current()
    private let defaults = UserDefaults(suiteName: Constants.appGroupID) ?? .standard
    /// 알림을 눌러 앱이 처음 켜질 때, 화면이 아직 없으면 여기 두었다가 화면이 가져간다.
    private var pendingOpen: URL?

    /// 앱이 뜰 때 한 번 부른다.
    func start() {
        center.delegate = self
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(becameActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    @objc private func becameActive() {
        arm()
    }

    // MARK: - 목록

    struct Job: Codable, Equatable {
        /// 1970 부터의 밀리초(웹의 Date.now() 와 같은 단위).
        let at: Double
        let kind: String
        let hour: Int?
        let date: String?

        var fireDate: Date { Date(timeIntervalSince1970: at / 1000) }
        var identifier: String { "\(AlarmCenter.prefix)\(Int(at))-\(kind)-\(hour.map(String.init) ?? date ?? "")" }
    }

    /// 웹이 넘긴 값을 읽는다. 틀린 줄, 지난 것, 너무 먼 것은 버린다.
    static func read(_ value: Any?, now: Date = Date()) -> [Job] {
        guard let list = value as? [Any] else { return [] }
        let from = now.timeIntervalSince1970 * 1000
        let to = from + aheadLimit * 1000
        var out: [Job] = []
        for raw in list.prefix(keepLimit * 2) {
            guard let item = raw as? [String: Any], let at = (item["at"] as? NSNumber)?.doubleValue,
                  at.isFinite, at > from, at <= to, let kind = item["kind"] as? String else { continue }
            if kind == "slot", let hour = (item["hour"] as? NSNumber)?.intValue, (0..<24).contains(hour) {
                out.append(Job(at: at, kind: kind, hour: hour, date: nil))
            } else if kind == "day", let date = item["date"] as? String,
                      date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
                out.append(Job(at: at, kind: kind, hour: nil, date: date))
            }
            if out.count >= keepLimit { break }
        }
        return out.sorted { $0.at < $1.at }
    }

    private var jobs: [Job] {
        get {
            guard let data = defaults.data(forKey: Self.storeKey),
                  let decoded = try? JSONDecoder().decode([Job].self, from: data) else { return [] }
            return decoded
        }
        set {
            defaults.set(try? JSONEncoder().encode(newValue), forKey: Self.storeKey)
        }
    }

    // MARK: - 켜기 · 맞추기 · 끄기

    /// 알림 권한을 묻는다. 이미 거절했으면 다시 묻지 못하니 설정으로 안내한다.
    func enable(done: @escaping (Bool, String?) -> Void) {
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                DispatchQueue.main.async { done(true, nil) }
            case .denied:
                DispatchQueue.main.async { done(false, "알림이 꺼져 있습니다. 설정 → 순찰일지 → 알림에서 켜 주세요.") }
            default:
                self.center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    DispatchQueue.main.async {
                        done(granted, granted ? nil : "알림을 허용해야 칸마다 울릴 수 있습니다.")
                    }
                }
            }
        }
    }

    /// 목록을 통째로 바꾸고 다시 건다. 빈 목록이면 이 앱이 건 초과기록 알림이 모두 사라진다.
    func replace(_ next: [Job], done: @escaping (Int) -> Void) {
        jobs = next
        arm(done: done)
    }

    func clear() {
        jobs = []
        arm()
    }

    /// 지난 것은 목록에서 빼고, 가까운 것부터 `armLimit` 건을 건다.
    func arm(done: ((Int) -> Void)? = nil) {
        let now = Date()
        let upcoming = jobs.filter { $0.fireDate > now }
        if upcoming.count != jobs.count { jobs = upcoming }
        let wanted = Array(upcoming.prefix(Self.armLimit))

        center.getPendingNotificationRequests { pending in
            let ours = pending.map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
            self.center.removePendingNotificationRequests(withIdentifiers: ours)
            for job in wanted {
                self.center.add(self.request(for: job))
            }
            DispatchQueue.main.async { done?(wanted.count) }
        }
    }

    private func request(for job: Job) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = "초과기록"
        content.body = Self.body(of: job)
        content.sound = .default
        content.threadIdentifier = "overtime"
        // 회의 · 방해 금지 중에도 칸 알림은 오게 한다. 권한(entitlement)이 없는 빌드에서는 보통 알림으로 온다.
        content.interruptionLevel = .timeSensitive
        content.userInfo = ["path": "/overtime"]

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: job.fireDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        return UNNotificationRequest(identifier: job.identifier, content: content, trigger: trigger)
    }

    /// `push.ts` 의 `messageOf` 와 같은 문장.
    static func body(of job: Job) -> String {
        if job.kind == "slot", let hour = job.hour {
            return "\(String(format: "%02d", hour))~\(String(format: "%02d", hour + 1))시 칸 [확인]을 누를 때입니다."
        }
        return "\(dayLabel(job.date ?? "")) 초과근무 확인자료를 올릴 차례입니다."
    }

    /// "2026-10-05" → "10/5(월)". `plan.ts` 의 `dayLabel` 과 같은 꼴.
    static func dayLabel(_ date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return date }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        guard let day = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) else {
            return "\(parts[1])/\(parts[2])"
        }
        let week = Array("일월화수목금토")[calendar.component(.weekday, from: day) - 1]
        return "\(parts[1])/\(parts[2])(\(week))"
    }

    // MARK: - 알림을 눌렀을 때

    /// 앱이 앞에 있어도 띄운다. 초과 중에 앱을 보고 있을 수 있다.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        guard let path = response.notification.request.content.userInfo["path"] as? String, path.hasPrefix("/"),
              var components = URLComponents(string: Constants.webURL) else { return }
        components.path = path
        // 같은 알림을 두 번 눌러도 다시 열리게 한 번마다 다른 주소로 만든다. 웹 화면은 이 값을 보지 않는다.
        components.queryItems = [URLQueryItem(name: "from", value: "alarm-\(Int(Date().timeIntervalSince1970))")]
        guard let url = components.url else { return }
        DispatchQueue.main.async {
            self.pendingOpen = url
            NotificationCenter.default.post(name: Self.openNotification, object: url)
        }
    }

    /// 알림을 눌러 앱이 켜졌는데 화면이 그 소식을 놓쳤을 때 가져간다. 한 번만 준다.
    func takePendingOpen() -> URL? {
        defer { pendingOpen = nil }
        return pendingOpen
    }
}

/// 웹 화면과 이어지는 통로. 이 사이트의 맨 위 화면에서 온 말만 듣는다.
///
///   { op: "enable" }          → 권한을 묻는다. { ok, why }
///   { op: "sync", jobs: [] }  → 울릴 목록을 통째로 바꾼다. { ok, armed }
///   { op: "off" }             → 모두 지운다. { ok }
final class AlarmBridge: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame, Constants.internalHosts.contains(message.frameInfo.securityOrigin.host),
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(["ok": false], nil)
            return
        }

        switch op {
        case "enable":
            AlarmCenter.shared.enable { ok, why in
                replyHandler(["ok": ok, "why": why ?? ""], nil)
            }
        case "sync":
            AlarmCenter.shared.replace(AlarmCenter.read(body["jobs"])) { armed in
                replyHandler(["ok": true, "armed": armed], nil)
            }
        case "off":
            AlarmCenter.shared.clear()
            replyHandler(["ok": true], nil)
        default:
            replyHandler(["ok": false], nil)
        }
    }
}
