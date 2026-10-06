import Foundation
import UIKit
import UserNotifications
import WebKit

/// 초과기록 알림을 이 기기 안에서 울린다.
///
/// 앱 안의 웹 화면에는 웹 푸시가 없다. 그래서 웹 화면이 셈한 「울릴 목록」(`src/core/overtime/alarms.ts` 의 `jobsOf`)을
/// `patrolAlarm` 통로로 넘기면, 앱이 그 시각에 기기 알림을 건다. 서버에는 아무것도 맡기지 않는다.
///
/// 넘어오는 것은 울릴 시각, 날짜, 칸 번호(시), 칸 수뿐이다. 근무시간, 사유, 이름은 오지 않는다.
///
/// 알림마다 단추가 있다(묻기: 남아요 · 안 남아요 / 칸: 눌렀어요 · 10분 뒤 · 못 눌렀어요 · 오늘은 끝났어요 / 다음 날: 올렸어요).
/// 단추를 누르면 앱이 바로 알림을 고치고, 그 답을 쌓아 두었다가 웹 화면이 열릴 때 넘긴다(`take`).
/// 단추는 본인이 적는 메모일 뿐이다. 인사랑에는 아무것도 보내지 않는다.
///
/// 한 앱이 걸어 둘 수 있는 알림은 64건이다. 목록 전체는 기기에 두고 가까운 것부터 `armLimit` 건만 건다.
/// 앱이 앞으로 올 때와 단추를 누를 때마다 다시 채운다.
final class AlarmCenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = AlarmCenter()

    /// 걸어 둘 알림 수. 64 한도에서 조금 남긴다.
    static let armLimit = 60
    /// 맡아 둘 목록의 길이. 한 달치 사전신청이 들어와도 넉넉하다.
    static let keepLimit = 400
    /// 얼마나 앞까지 받는가. 한 달치 + 며칠.
    static let aheadLimit: TimeInterval = 40 * 24 * 3600
    /// 「10분 뒤」.
    static let snoozeSeconds: TimeInterval = 10 * 60

    private static let prefix = "ot-"
    private static let jobsKey = "overtimeAlarms"
    private static let snoozeKey = "overtimeSnoozes"
    private static let eventsKey = "overtimeEvents"
    private static let soundKey = "overtimeSound"
    static let openNotification = Notification.Name("patrolOpenURL")

    enum Category {
        static let ask = "ot-ask"
        static let slot = "ot-slot"
        static let day = "ot-day"
        static let sum = "ot-sum"
    }

    enum Action {
        static let stay = "stay"
        static let leave = "leave"
        static let done = "done"
        static let snooze = "snooze"
        static let missed = "missed"
        static let end = "end"
        static let uploaded = "uploaded"
    }

    private let center = UNUserNotificationCenter.current()
    private let defaults = UserDefaults(suiteName: Constants.appGroupID) ?? .standard
    /// 알림을 눌러 앱이 처음 켜질 때, 화면이 아직 없으면 여기 두었다가 화면이 가져간다.
    private var pendingOpen: URL?

    /// 앱이 뜰 때 한 번 부른다.
    func start() {
        center.delegate = self
        center.setNotificationCategories(Self.categories)
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

    private static var categories: Set<UNNotificationCategory> {
        let stay = UNNotificationAction(identifier: Action.stay, title: "남아요")
        let leave = UNNotificationAction(identifier: Action.leave, title: "오늘 안 남아요", options: [.destructive])
        let done = UNNotificationAction(identifier: Action.done, title: "눌렀어요")
        let snooze = UNNotificationAction(identifier: Action.snooze, title: "10분 뒤")
        let missed = UNNotificationAction(identifier: Action.missed, title: "못 눌렀어요", options: [.foreground])
        let end = UNNotificationAction(identifier: Action.end, title: "오늘은 끝났어요", options: [.destructive])
        let uploaded = UNNotificationAction(identifier: Action.uploaded, title: "올렸어요")
        return [
            UNNotificationCategory(identifier: Category.ask, actions: [stay, leave], intentIdentifiers: []),
            UNNotificationCategory(identifier: Category.slot, actions: [done, snooze, missed, end], intentIdentifiers: []),
            UNNotificationCategory(identifier: Category.day, actions: [uploaded], intentIdentifiers: []),
            UNNotificationCategory(identifier: Category.sum, actions: [], intentIdentifiers: []),
        ]
    }

    // MARK: - 목록

    struct Job: Codable, Equatable {
        /// 1970 부터의 밀리초(웹의 Date.now() 와 같은 단위).
        let at: Double
        let kind: String
        let date: String
        var hour: Int? = nil
        var until: Int? = nil
        var clicks: Int? = nil
        var reasons: Int? = nil
        var pressed: [Int]? = nil
        /// 정각 10분 전 한 번 더(아직 안 누른 칸). 글 앞에 🟠.
        var again: Bool? = nil

        var fireDate: Date { Date(timeIntervalSince1970: at / 1000) }
        var identifier: String { "\(AlarmCenter.prefix)\(Int(at))-\(kind)-\(date)-\(hour.map(String.init) ?? "")" }
    }

    /// 알림 단추로 받은 답. `alarms.ts` 의 `AlarmEvent` 와 같은 꼴.
    struct Event: Codable, Equatable {
        let op: String
        let date: String
        var hour: Int? = nil
        var minute: Int? = nil
    }

    private static func isDate(_ text: String) -> Bool {
        text.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }

    private static func int(_ value: Any?) -> Int? {
        (value as? NSNumber)?.intValue
    }

    /// 웹이 넘긴 값을 읽는다. 틀린 줄, 지난 것, 너무 먼 것은 버린다.
    static func read(_ value: Any?, now: Date = Date()) -> [Job] {
        guard let list = value as? [Any] else { return [] }
        let from = now.timeIntervalSince1970 * 1000
        let to = from + aheadLimit * 1000
        let hours = 0..<24
        var out: [Job] = []
        for raw in list.prefix(keepLimit * 2) {
            guard let item = raw as? [String: Any], let at = (item["at"] as? NSNumber)?.doubleValue,
                  at.isFinite, at > from, at <= to, let kind = item["kind"] as? String,
                  let date = item["date"] as? String, isDate(date) else { continue }
            let hour = int(item["hour"])
            switch kind {
            case "slot":
                guard let hour, hours.contains(hour) else { continue }
                out.append(Job(at: at, kind: kind, date: date, hour: hour, again: (item["again"] as? Bool) == true ? true : nil))
            case "ask":
                guard let hour, hours.contains(hour), let until = int(item["until"]), until > hour, until <= 24 else { continue }
                out.append(Job(at: at, kind: kind, date: date, hour: hour, until: until))
            case "sum":
                guard let clicks = int(item["clicks"]), let reasons = int(item["reasons"]),
                      (0...24).contains(clicks), (0...24).contains(reasons) else { continue }
                let pressed = (item["pressed"] as? [Any] ?? []).compactMap(int).filter { hours.contains($0) }
                out.append(Job(at: at, kind: kind, date: date, clicks: clicks, reasons: reasons, pressed: pressed))
            case "day":
                out.append(Job(at: at, kind: kind, date: date))
            default:
                continue
            }
            if out.count >= keepLimit { break }
        }
        return out.sorted { $0.at < $1.at }
    }

    private func load<T: Decodable>(_ key: String) -> [T] {
        guard let data = defaults.data(forKey: key), let decoded = try? JSONDecoder().decode([T].self, from: data) else { return [] }
        return decoded
    }

    private func save<T: Encodable>(_ value: [T], _ key: String) {
        defaults.set(try? JSONEncoder().encode(value), forKey: key)
    }

    private var jobs: [Job] {
        get { load(Self.jobsKey) }
        set { save(newValue, Self.jobsKey) }
    }

    /// 「10분 뒤」로 다시 거는 칸. 웹이 목록을 통째로 바꿔도 지워지지 않게 따로 둔다.
    private var snoozes: [Job] {
        get { load(Self.snoozeKey) }
        set { save(newValue, Self.snoozeKey) }
    }

    private var events: [Event] {
        get { load(Self.eventsKey) }
        set { save(Array(newValue.suffix(300)), Self.eventsKey) }
    }

    // MARK: - 켜기 · 맞추기 · 끄기 · 답 넘기기

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

    /// 소리 · 진동. 화면의 알림 설정에서 「무음」을 고르면 false.
    private var sound: Bool {
        get { defaults.object(forKey: Self.soundKey) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Self.soundKey) }
    }

    /// 목록을 통째로 바꾸고 다시 건다. 빈 목록이면 이 앱이 건 초과기록 알림이 모두 사라진다.
    func replace(_ next: [Job], sound: Bool = true, done: @escaping (Int) -> Void) {
        self.sound = sound
        jobs = next
        arm(done: done)
    }

    func clear() {
        jobs = []
        snoozes = []
        arm()
    }

    /// 쌓인 답을 넘기고 지운다.
    func take() -> [[String: Any]] {
        let out = events.map { e -> [String: Any] in
            var item: [String: Any] = ["op": e.op, "date": e.date]
            if let hour = e.hour { item["hour"] = hour }
            if let minute = e.minute { item["minute"] = minute }
            return item
        }
        events = []
        return out
    }

    /// 지난 것은 빼고, 가까운 것부터 `armLimit` 건을 건다. 요약 글은 걸 때마다 지금까지의 답으로 다시 쓴다.
    func arm(done: ((Int) -> Void)? = nil) {
        let now = Date()
        let upcoming = jobs.filter { $0.fireDate > now }
        if upcoming.count != jobs.count { jobs = upcoming }
        let snoozed = snoozes.filter { $0.fireDate > now }
        if snoozed.count != snoozes.count { snoozes = snoozed }
        let wanted = Array((upcoming + snoozed).sorted { $0.at < $1.at }.prefix(Self.armLimit))
        let answered = events
        let sound = self.sound

        center.getPendingNotificationRequests { pending in
            let ours = pending.map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
            self.center.removePendingNotificationRequests(withIdentifiers: ours)
            for job in wanted {
                self.center.add(self.request(for: job, answered: answered, sound: sound))
            }
            DispatchQueue.main.async { done?(wanted.count) }
        }
    }

    private func request(for job: Job, answered: [Event], sound: Bool) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = "초과기록"
        content.body = Self.body(of: job, answered: answered)
        // 무음이면 소리도 진동도 없이 뜨기만 한다. 집중 모드도 뚫지 않는다.
        content.sound = sound ? .default : nil
        content.threadIdentifier = "overtime"
        // 회의 · 방해 금지 중에도 칸 알림은 오게 한다. 권한(entitlement)이 없는 빌드에서는 보통 알림으로 온다.
        content.interruptionLevel = job.kind == "sum" || !sound ? .active : .timeSensitive
        content.categoryIdentifier = Self.category(of: job)
        var info: [String: Any] = ["path": "/overtime", "kind": job.kind, "date": job.date]
        if let hour = job.hour { info["hour"] = hour }
        if let until = job.until { info["until"] = until }
        content.userInfo = info

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: job.fireDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        return UNNotificationRequest(identifier: job.identifier, content: content, trigger: trigger)
    }

    private static func category(of job: Job) -> String {
        switch job.kind {
        case "ask": return Category.ask
        case "slot": return Category.slot
        case "day": return Category.day
        default: return Category.sum
        }
    }

    private static func hours(_ from: Int, _ to: Int) -> String {
        "\(String(format: "%02d", from))~\(String(format: "%02d", to))시"
    }

    /// 알림 글. 칸 · 다음 날은 `push.ts` 의 `messageOf` 와 같은 문장.
    static func body(of job: Job, answered: [Event] = []) -> String {
        switch job.kind {
        case "slot":
            let hour = job.hour ?? 0
            if job.again == true { return "🟠 \(hours(hour, hour + 1)) 칸이 10분 남았습니다. 아직이면 [확인]을 누릅니다." }
            return "\(hours(hour, hour + 1)) 칸 [확인]을 누를 때입니다."
        case "ask":
            let hour = job.hour ?? 0
            return "\(dayLabel(job.date)) \(hours(hour, job.until ?? hour + 1)) 초과 신청이 걸려 있습니다. 남으세요?"
        case "sum":
            var pressed = Set(job.pressed ?? [])
            for e in answered where e.date == job.date {
                guard let hour = e.hour else { continue }
                if e.op == "done" { pressed.insert(hour) }
                if e.op == "missed" { pressed.remove(hour) }
            }
            var line = "오늘 초과가 끝났습니다. [확인] \(job.clicks ?? 0)칸 중 눌렀어요 \(pressed.count)"
            if let reasons = job.reasons, reasons > 0 { line += " · 사유 쓸 칸 \(reasons)" }
            return line + ". 못 누른 칸은 사유를 씁니다."
        default:
            return "\(dayLabel(job.date)) 초과근무 확인자료를 올릴 차례입니다."
        }
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

    /// 한국 시각으로 지금이 그날의 몇 분인가.
    private static func minuteNow() -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        let parts = calendar.dateComponents([.hour, .minute], from: Date())
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }

    // MARK: - 알림 단추

    /// 단추 하나를 처리한다. 걸린 알림을 고치고 답을 쌓는다. 웹 화면이 열리면 같은 답으로 같은 목록을 다시 셈한다.
    private func handle(action: String, info: [AnyHashable: Any]) {
        guard let date = info["date"] as? String, Self.isDate(date) else { return }
        let hour = Self.int(info["hour"])
        let until = Self.int(info["until"])

        switch action {
        case Action.stay:
            guard let hour else { return }
            events += [Event(op: "stay", date: date, hour: hour)]
            jobs = jobs.filter { !($0.kind == "ask" && $0.date == date && $0.hour == hour) }
        case Action.leave:
            guard let hour else { return }
            events += [Event(op: "leave", date: date, hour: hour)]
            let end = until ?? hour + 1
            let inside: (Job) -> Bool = { job in
                job.date == date && (job.kind == "slot" || job.kind == "ask") && (job.hour ?? -1) >= hour && (job.hour ?? -1) < end
            }
            jobs = jobs.filter { !inside($0) }
            snoozes = snoozes.filter { !inside($0) }
            // 그날 칸이 하나도 안 남으면 요약도 뺀다.
            if !jobs.contains(where: { $0.date == date && $0.kind == "slot" }) {
                jobs = jobs.filter { !($0.date == date && $0.kind == "sum") }
            }
        case Action.done:
            guard let hour else { return }
            events += [Event(op: "done", date: date, hour: hour)]
            snoozes = snoozes.filter { !($0.date == date && $0.hour == hour) }
            // 이 칸의 한 번 더 알림(50분)도 뺀다.
            jobs = jobs.filter { !($0.date == date && $0.kind == "slot" && $0.hour == hour) }
        case Action.snooze:
            guard let hour else { return }
            let at = (Date().timeIntervalSince1970 + Self.snoozeSeconds) * 1000
            snoozes = snoozes.filter { !($0.date == date && $0.hour == hour) } + [Job(at: at, kind: "slot", date: date, hour: hour)]
        case Action.missed:
            guard let hour else { return }
            events += [Event(op: "missed", date: date, hour: hour)]
            snoozes = snoozes.filter { !($0.date == date && $0.hour == hour) }
            jobs = jobs.filter { !($0.date == date && $0.kind == "slot" && $0.hour == hour) }
        case Action.end:
            events += [Event(op: "end", date: date, minute: Self.minuteNow())]
            let now = Date()
            let later: (Job) -> Bool = { job in
                job.date == date && job.kind != "day" && job.fireDate > now
            }
            jobs = jobs.filter { !later($0) }
            snoozes = snoozes.filter { $0.date != date }
        case Action.uploaded:
            events += [Event(op: "uploaded", date: date)]
            jobs = jobs.filter { !($0.date == date && $0.kind == "day") }
        default:
            return
        }
        arm()
    }

    // MARK: - 알림이 떴을 때 · 눌렀을 때

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
        let info = response.notification.request.content.userInfo
        let action = response.actionIdentifier

        DispatchQueue.main.async {
            defer { completionHandler() }
            if action != UNNotificationDefaultActionIdentifier && action != UNNotificationDismissActionIdentifier {
                self.handle(action: action, info: info)
            }
            // 알림 자체를 눌렀을 때와 「못 눌렀어요」만 화면을 연다. 나머지 단추는 앱을 열지 않는다.
            guard action == UNNotificationDefaultActionIdentifier || action == Action.missed else { return }
            self.open(info: info)
        }
    }

    private func open(info: [AnyHashable: Any]) {
        guard let path = info["path"] as? String, path.hasPrefix("/"),
              var components = URLComponents(string: Constants.webURL) else { return }
        components.path = path
        var query: [URLQueryItem] = []
        if let date = info["date"] as? String, Self.isDate(date) { query.append(URLQueryItem(name: "date", value: date)) }
        if (info["kind"] as? String) == "slot", let hour = Self.int(info["hour"]) {
            query.append(URLQueryItem(name: "slot", value: String(hour)))
        }
        // 같은 알림을 두 번 눌러도 다시 열리게 한 번마다 다른 주소로 만든다. 웹 화면은 이 값을 보지 않는다.
        query.append(URLQueryItem(name: "from", value: "alarm-\(Int(Date().timeIntervalSince1970))"))
        components.queryItems = query
        guard let url = components.url else { return }
        pendingOpen = url
        NotificationCenter.default.post(name: Self.openNotification, object: url)
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
///   { op: "sync", jobs: [], sound }  → 울릴 목록을 통째로 바꾼다. sound 가 false 면 무음. { ok, armed }
///   { op: "take" }            → 알림 단추로 받은 답을 넘기고 지운다. { ok, events }
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
            AlarmCenter.shared.replace(AlarmCenter.read(body["jobs"]), sound: body["sound"] as? Bool ?? true) { armed in
                replyHandler(["ok": true, "armed": armed], nil)
            }
        case "take":
            replyHandler(["ok": true, "events": AlarmCenter.shared.take()], nil)
        case "off":
            AlarmCenter.shared.clear()
            replyHandler(["ok": true], nil)
        default:
            replyHandler(["ok": false], nil)
        }
    }
}
