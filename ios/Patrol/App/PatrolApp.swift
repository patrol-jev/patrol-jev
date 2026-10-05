import SwiftUI

@main
struct PatrolApp: App {
    init() {
        AlarmCenter.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
