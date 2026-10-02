import SwiftUI
import WebKit

struct WebViewController: UIViewControllerRepresentable {
    @Binding var isLoading: Bool
    @Binding var loadFailed: Bool
    /// 값이 바뀌면 첫 주소를 다시 부른다(「다시 시도」).
    let reloadToken: Int

    func makeUIViewController(context: Context) -> WebViewHostController {
        let controller = WebViewHostController()
        controller.coordinator = context.coordinator
        context.coordinator.host = controller
        return controller
    }

    func updateUIViewController(_ controller: WebViewHostController, context: Context) {
        controller.reloadIfNeeded(token: reloadToken)
    }

    func makeCoordinator() -> WebViewCoordinator {
        WebViewCoordinator(isLoading: $isLoading, loadFailed: $loadFailed)
    }
}

final class WebViewHostController: UIViewController {
    var coordinator: WebViewCoordinator?
    private var webView: WKWebView!
    private var lastToken = 0

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // 웹 쪽에서 앱 안인지 알 수 있게 이름표만 붙인다. 기기 정보는 더하지 않는다.
        config.applicationNameForUserAgent = "PatrolApp"

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground

        view.backgroundColor = .systemBackground
        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        coordinator?.webView = webView

        // 앱을 덮을 때 위젯 숫자를 맞춘다. 일지를 만든 직후가 대개 이때다.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillResignActive),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )

        loadStart()
    }

    func reloadIfNeeded(token: Int) {
        guard token != lastToken else { return }
        lastToken = token
        loadStart()
    }

    private func loadStart() {
        guard isViewLoaded, let url = URL(string: Constants.webURL) else { return }
        webView.load(URLRequest(url: url))
    }

    @objc private func appWillResignActive() {
        coordinator?.syncDays()
    }
}
