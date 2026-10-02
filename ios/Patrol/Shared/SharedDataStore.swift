import Foundation

/// 앱에서 위젯으로 건너가는 것은 날짜와 그날의 사진 장수뿐이다.
/// 일지 글, 주소, 사진은 건너가지 않는다. 이 기기 밖으로도 나가지 않는다.
struct PatrolDay: Codable, Equatable {
    /// YYYY-MM-DD
    let date: String
    let photos: Int
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
}

/// 위젯에 적을 숫자. 이번 달 며칠 썼는지, 사진이 몇 장인지, 마지막이 언제인지.
struct PatrolSummary: Equatable {
    let monthDays: Int
    let monthPhotos: Int
    /// 「10월 3일」 꼴. 기록이 없으면 nil.
    let lastLabel: String?
    let doneToday: Bool

    static let sample = PatrolSummary(monthDays: 12, monthPhotos: 286, lastLabel: "오늘", doneToday: true)

    static func of(_ days: [PatrolDay], now: Date = Date()) -> PatrolSummary {
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
            doneToday: last == today
        )
    }
}
