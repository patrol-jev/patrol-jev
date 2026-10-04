import WidgetKit
import SwiftUI

@main
struct PatrolWidgetBundle: WidgetBundle {
    var body: some Widget {
        PatrolMonthWidget()
    }
}

// MARK: - 이번 달 순찰일지 (홈 화면 작은 것·중간 것, 잠금 화면)

struct PatrolMonthWidget: Widget {
    let kind = "PatrolMonth"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PatrolTimelineProvider()) { entry in
            PatrolMonthView(entry: entry)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("이번 달 순찰일지")
        .description("이번 달에 일지를 며칠 만들었는지, 사진을 읽는 데 보통 몇 초가 걸렸는지 봅니다.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Timeline

struct PatrolEntry: TimelineEntry {
    let date: Date
    let summary: PatrolSummary
}

/// 숫자는 앱이 이 기기에 적어 둔 것만 읽는다. 위젯은 어디에도 묻지 않는다.
struct PatrolTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> PatrolEntry {
        PatrolEntry(date: Date(), summary: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (PatrolEntry) -> Void) {
        completion(context.isPreview ? PatrolEntry(date: Date(), summary: .sample) : current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PatrolEntry>) -> Void) {
        // 날이 바뀌면 「오늘」과 달 숫자가 달라진다. 자정 조금 뒤에 한 번 다시 그린다.
        let midnight = Calendar.current.nextDate(
            after: Date(),
            matching: DateComponents(hour: 0, minute: 5),
            matchingPolicy: .nextTime
        ) ?? Date().addingTimeInterval(6 * 3600)

        completion(Timeline(entries: [current()], policy: .after(midnight)))
    }

    private func current() -> PatrolEntry {
        let store = SharedDataStore.shared
        return PatrolEntry(date: Date(), summary: PatrolSummary.of(store.days, stats: store.stats))
    }
}

// MARK: - Views

struct PatrolMonthView: View {
    @Environment(\.widgetFamily) private var family
    let entry: PatrolEntry

    private var summary: PatrolSummary { entry.summary }

    private var lastLine: String {
        guard let last = summary.lastLabel else { return "아직 기록이 없습니다" }
        return summary.doneToday ? "오늘 만들었습니다" : "마지막 \(last)"
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text("순찰일지 이번 달 \(summary.monthDays)일")

        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text("순찰일지")
                    .font(.headline)
                Text("이번 달 \(summary.monthDays)일 · 사진 \(summary.monthPhotos)장")
                Text(summary.stats?.medianLine ?? lastLine)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

        case .systemMedium:
            HStack(alignment: .center, spacing: 20) {
                count
                VStack(alignment: .leading, spacing: 4) {
                    Text("사진 \(summary.monthPhotos)장")
                        .font(.system(size: 17, weight: .semibold))
                    if let median = summary.stats?.medianLine {
                        Text(median)
                            .font(.system(size: 14, weight: .medium))
                    }
                    if let total = summary.stats?.totalLine {
                        Text(total)
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }
                    Text(lastLine)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }

        default:
            VStack(alignment: .leading, spacing: 6) {
                count
                Spacer(minLength: 0)
                if let median = summary.stats?.medianLine {
                    Text(median)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Text(lastLine)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var count: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("순찰일지")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text("\(summary.monthDays)")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(red: 249 / 255, green: 135 / 255, blue: 31 / 255))
                Text("일")
                    .font(.system(size: 17, weight: .semibold))
            }
            Text("이번 달")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
        }
    }
}
