import SwiftUI

struct ContentView: View {
    @State private var isLoading = true
    @State private var loadFailed = false
    @State private var reloadToken = 0

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            WebViewController(isLoading: $isLoading, loadFailed: $loadFailed, reloadToken: reloadToken)

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
    }
}
