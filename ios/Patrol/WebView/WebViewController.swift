import SwiftUI
import WebKit

struct WebViewController: UIViewControllerRepresentable {
    @Binding var isLoading: Bool
    @Binding var loadFailed: Bool
    /// 값이 바뀌면 첫 주소를 다시 부른다(「다시 시도」).
    let reloadToken: Int
    /// 밖에서 받은 주소. 값이 바뀌면 그 화면을 연다.
    let incoming: URL?

    func makeUIViewController(context: Context) -> WebViewHostController {
        let controller = WebViewHostController()
        controller.coordinator = context.coordinator
        context.coordinator.host = controller
        return controller
    }

    func updateUIViewController(_ controller: WebViewHostController, context: Context) {
        controller.reloadIfNeeded(token: reloadToken)
        controller.openIfNeeded(incoming)
    }

    func makeCoordinator() -> WebViewCoordinator {
        WebViewCoordinator(isLoading: $isLoading, loadFailed: $loadFailed)
    }
}

final class WebViewHostController: UIViewController {
    var coordinator: WebViewCoordinator?
    private var webView: WKWebView!
    private var lastToken = 0
    private var lastIncoming: URL?

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // 웹 쪽에서 앱 안인지 알 수 있게 이름표만 붙인다. 기기 정보는 더하지 않는다.
        config.applicationNameForUserAgent = "PatrolApp"
        // 웹 화면이 기록을 고치면 바로 위젯 숫자를 맞춘다.
        if let coordinator {
            config.userContentController.addUserScript(WebViewCoordinator.syncScript)
            config.userContentController.add(coordinator, name: Constants.syncMessage)
        }

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

    /// 밖에서 받은 주소를 연다. 같은 주소를 두 번 받아도 한 번만 연다.
    func openIfNeeded(_ url: URL?) {
        guard let url, url != lastIncoming, isViewLoaded else { return }
        lastIncoming = url
        webView.load(URLRequest(url: url))
    }

    private func loadStart() {
        guard isViewLoaded, let url = URL(string: Constants.webURL) else { return }
        webView.load(URLRequest(url: url))
    }

    @objc private func appWillResignActive() {
        coordinator?.syncDays()
    }
}
