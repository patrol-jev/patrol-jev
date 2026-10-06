import SwiftUI

struct ContentView: View {
    @State private var isLoading = true
    @State private var loadFailed = false
    @State private var reloadToken = 0
    /// 밖에서 받은 이 사이트의 주소(메일, QR). 앱이 그 화면으로 연다.
    @State private var incoming: URL?

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            WebViewController(isLoading: $isLoading, loadFailed: $loadFailed, reloadToken: reloadToken, incoming: incoming)

            if loadFailed {
                OfflineView {
                    loadFailed = false
                    isLoading = true
                    reloadToken += 1
                }
            } else if isLoading {
                SplashView()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.3), value: isLoading)
        // 이 앱이 여는 사이트의 주소만 받는다. 다른 주소는 버린다.
        .onOpenURL { url in
            guard let host = url.host, Constants.internalHosts.contains(host), url.scheme == "https" else { return }
            incoming = url
        }
        // 초과기록 알림을 누르면 그 화면으로.
        .onReceive(NotificationCenter.default.publisher(for: AlarmCenter.openNotification)) { note in
            if let url = note.object as? URL { incoming = url }
        }
        .onAppear {
            if let url = AlarmCenter.shared.takePendingOpen() { incoming = url }
        }
        // 알림을 눌러 앞으로 올 때 위 소식을 놓쳤으면 여기서 가져간다.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            if let url = AlarmCenter.shared.takePendingOpen() { incoming = url }
        }
    }
}
