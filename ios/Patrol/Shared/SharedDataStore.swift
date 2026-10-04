import Foundation

/// 앱에서 위젯으로 건너가는 것은 날짜와 그날의 사진 장수, 그리고 회차의 숫자(몇 회, 몇 장, 몇 초)뿐이다.
/// 일지 글, 주소, 사진은 건너가지 않는다. 이 기기 밖으로도 나가지 않는다.
struct PatrolDay: Codable, Equatable {
    /// YYYY-MM-DD
    let date: String
    let photos: Int
}

/// 지금까지의 회차를 숫자로 줄인 것. 「전에는 얼마나 걸렸나」를 답하지 않은 사람도 있으니
/// 견줄 값 없이도 서는 숫자만 둔다. 사진을 읽고 가르는 데 걸린 시간의 중앙값이 그것이다.
struct PatrolStats: Codable, Equatable {
    /// 지금까지 몇 회, 몇 장. 직접 적은 회차도 센다.
    let runs: Int
    let photos: Int
    /// 사진을 읽은 회차만으로 낸 중앙값. 그런 회차가 없으면 nil.
    let medianSeconds: Double?
    let medianPhotos: Int?

    static let sample = PatrolStats(runs: 18, photos: 412, medianSeconds: 19.4, medianPhotos: 22)

    /// 한 회차의 숫자. `seconds` 는 사진을 글로 옮기고 갈래를 가른 시간이고, 직접 적은 회차는 0 이다.
    struct Run {
        let photos: Int
        let seconds: Double
        let manual: Bool
    }

    static func of(_ runs: [Run]) -> PatrolStats {
        let read = runs.filter { !$0.manual && $0.seconds > 0 && $0.photos > 0 }
        // 가운데 값은 웹 화면의 셈(`summarise`)과 같은 자리에서 고른다. 두 숫자가 달라 보이면 안 된다.
        let seconds = read.map(\.seconds).sorted()
        let photos = read.map(\.photos).sorted()
        return PatrolStats(
            runs: runs.count,
            photos: runs.reduce(0) { $0 + $1.photos },
            medianSeconds: seconds.isEmpty ? nil : seconds[seconds.count / 2],
            medianPhotos: photos.isEmpty ? nil : photos[photos.count / 2]
        )
    }

    /// 「분석 19초 · 회당 22장」 꼴. 사진을 읽은 회차가 없으면 nil.
    var medianLine: String? {
        guard let medianSeconds, let medianPhotos else { return nil }
        return "분석 \(PatrolStats.clock(medianSeconds)) · 회당 \(medianPhotos)장"
    }

    /// 「누적 18회 · 412장」 꼴. 회차가 없으면 nil.
    var totalLine: String? {
        runs > 0 ? "누적 \(runs)회 · \(photos)장" : nil
    }

    static func clock(_ seconds: Double) -> String {
        if seconds < 10 { return String(format: "%.1f초", seconds) }
        let whole = Int(seconds.rounded())
        if whole < 60 { return "\(whole)초" }
        return whole % 60 == 0 ? "\(whole / 60)분" : "\(whole / 60)분 \(whole % 60)초"
    }
}

final class SharedDataStore {
    static let shared = SharedDataStore()

    private let defaults: UserDefaults

    private init() {
        defaults = UserDefaults(suiteName: Constants.appGroupID) ?? .standard
    }

    var days: [PatrolDay] {
        get {
            guard let data = defaults.data(forKey: "days"),
                  let decoded = try? JSONDecoder().decode([PatrolDay].self, from: data) else { return [] }
            return decoded
        }
        set {
            defaults.set(try? JSONEncoder().encode(newValue), forKey: "days")
        }
    }

    var stats: PatrolStats? {
        get {
            guard let data = defaults.data(forKey: "stats") else { return nil }
            return try? JSONDecoder().decode(PatrolStats.self, from: data)
        }
        set {
            defaults.set(try? JSONEncoder().encode(newValue), forKey: "stats")
        }
    }
}

/// 위젯에 적을 숫자. 이번 달 며칠 썼는지, 사진이 몇 장인지, 마지막이 언제인지.
struct PatrolSummary: Equatable {
    let monthDays: Int
    let monthPhotos: Int
    /// 「10월 3일」 꼴. 기록이 없으면 nil.
    let lastLabel: String?
    let doneToday: Bool
    /// 지금까지의 회차 숫자. 앱이 아직 한 번도 안 적었으면 nil.
    var stats: PatrolStats? = nil

    static let sample = PatrolSummary(monthDays: 12, monthPhotos: 286, lastLabel: "오늘", doneToday: true, stats: PatrolStats.sample)

    static func of(_ days: [PatrolDay], stats: PatrolStats? = nil, now: Date = Date()) -> PatrolSummary {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: now)
        let month = String(today.prefix(7))

        let inMonth = days.filter { $0.date.hasPrefix(month) }
        let last = days.map(\.date).max()

        var label: String? = nil
        if let last {
            if last == today {
                label = "오늘"
            } else {
                let parts = last.split(separator: "-").compactMap { Int($0) }
                label = parts.count == 3 ? "\(parts[1])월 \(parts[2])일" : last
            }
        }

        return PatrolSummary(
            monthDays: inMonth.count,
            monthPhotos: inMonth.reduce(0) { $0 + $1.photos },
            lastLabel: label,
            doneToday: last == today,
            stats: stats
        )
    }
}
