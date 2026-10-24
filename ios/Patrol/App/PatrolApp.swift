import SwiftUI

@main
struct PatrolApp: App {
    @Environment(\.scenePhase) private var scenePhase

    init() {
        AlarmCenter.shared.start()
        // 앱이 꺼져 있을 때의 새 사진 훑기. 등록은 켜질 때 끝나 있어야 한다.
        BackgroundScout.shared.register()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .onChange(of: scenePhase) { _, phase in
            // 뒤로 갈 때마다 다음 틈을 잡는다(자동 보기를 켠 기기만).
            if phase == .background { BackgroundScout.shared.schedule() }
        }
    }
}
