import SwiftUI

struct SplashView: View {
    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                Text("순찰일지")
                    .font(.system(size: 28, weight: .bold))

                Text("사진을 올리면 순찰일지 글이 나옵니다.")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)

                ProgressView()
                    .padding(.top, 20)
            }
        }
    }
}

/// 첫 화면을 못 불러왔을 때. 빈 화면으로 두지 않고 까닭과 다시 누를 자리를 준다.
struct OfflineView: View {
    let retry: () -> Void

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                Text("화면을 불러오지 못했습니다")
                    .font(.system(size: 20, weight: .semibold))

                Text("인터넷 연결을 확인하고 다시 눌러 주세요.")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)

                Button("다시 시도", action: retry)
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 12)
            }
            .padding(24)
        }
    }
}
