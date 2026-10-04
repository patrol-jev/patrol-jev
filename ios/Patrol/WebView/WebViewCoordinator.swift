import SwiftUI
import WebKit
import WidgetKit

/// 웹 화면이 못 하는 세 가지를 앱이 대신 한다.
///
/// 1. 파일 받기. 한글 파일, 묶음 파일, 그림은 화면 안에서 만들어 내려받게 되어 있는데
///    앱 안의 웹 화면은 그것을 저절로 받지 못한다. 받아서 공유 창으로 넘긴다.
/// 2. 밖으로 나가는 주소는 사파리로 넘긴다. 이 앱은 한 사이트만 연다.
/// 3. 위젯에 적을 숫자(날짜와 사진 장수, 회차의 장수와 걸린 시간)를 웹 화면의 기록에서 읽어 둔다.
final class WebViewCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    @Binding var isLoading: Bool
    @Binding var loadFailed: Bool
    weak var webView: WKWebView?
    weak var host: UIViewController?

    private var loadedOnce = false
    private var downloads: [WKDownload: URL] = [:]

    init(isLoading: Binding<Bool>, loadFailed: Binding<Bool>) {
        _isLoading = isLoading
        _loadFailed = loadFailed
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadedOnce = true
        DispatchQueue.main.async {
            self.isLoading = false
            self.loadFailed = false
        }
        syncDays()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.async {
            self.isLoading = false
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let failure = error as NSError
        // 사람이 멈춘 것(-999)과 내려받기로 바뀐 것(102)은 실패가 아니다.
        if failure.code == NSURLErrorCancelled || (failure.domain == "WebKitErrorDomain" && failure.code == 102) {
            return
        }
        DispatchQueue.main.async {
            self.isLoading = false
            // 쓰던 화면을 가리지 않는다. 처음부터 못 연 경우에만 안내를 띄운다.
            if !self.loadedOnce {
                self.loadFailed = true
            }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // 사진을 많이 올리면 기기가 웹 화면을 내릴 수 있다. 흰 화면으로 두지 않는다.
        webView.reload()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }

        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }

        if scheme == "http" || scheme == "https" {
            let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
            if mainFrame, let target = url.host, !Constants.internalHosts.contains(target) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
            return
        }

        if ["about", "blob", "data"].contains(scheme) {
            decisionHandler(.allow)
            return
        }

        // tel:, mailto: 같은 것
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        guard navigationResponse.isForMainFrame else {
            decisionHandler(.allow)
            return
        }

        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?
            .lowercased() ?? ""

        if disposition.hasPrefix("attachment") || !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // MARK: - WKDownloadDelegate

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        // 받을 때마다 새 폴더. 같은 이름의 파일이 있으면 내려받기가 실패한다.
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }

        let cleaned = suggestedFilename.replacingOccurrences(of: "/", with: "_")
        let target = folder.appendingPathComponent(cleaned.isEmpty ? "patrol" : cleaned)
        downloads[download] = target
        completionHandler(target)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: download) else { return }
        DispatchQueue.main.async {
            self.share(file)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: download)
        DispatchQueue.main.async {
            self.say("파일을 받지 못했습니다. 다시 눌러 주세요.") {}
        }
    }

    // MARK: - WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // 새 창으로 여는 주소. 우리 사이트면 이 화면에서, 아니면 사파리에서.
        if let url = navigationAction.request.url {
            if let target = url.host, Constants.internalHosts.contains(target) {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        say(message, done: completionHandler)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        guard let presenter = presenter() else {
            completionHandler(false)
            return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
        presenter.present(alert, animated: true)
    }

    // MARK: - 위젯 숫자

    private struct RawDay: Decodable {
        let date: String
        let photos: Int
    }

    private struct RawRun: Decodable {
        let photos: Int
        let ms: Double
        let manual: Bool
    }

    private struct RawSync: Decodable {
        let days: [RawDay]
        let runs: [RawRun]
    }

    /// 웹 화면이 두 기록 가운데 하나를 고칠 때마다 앱에 알리게 한다. 이것이 없으면 일지를 만든 뒤
    /// 앱을 덮거나 다시 열 때까지 위젯이 옛 숫자에 머문다. 알리는 것은 「고쳤다」는 사실뿐이고 값은 싣지 않는다.
    static var syncScript: WKUserScript {
        let source = """
        (function () {
          var keys = ['\(Constants.daysKey)', '\(Constants.runsKey)'];
          var tell = function (key) {
            if (keys.indexOf(key) < 0) return;
            try { window.webkit.messageHandlers.\(Constants.syncMessage).postMessage(1); } catch (e) {}
          };
          var set = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key) { set.apply(this, arguments); tell(key); };
          var remove = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) { remove.apply(this, arguments); tell(key); };
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    private var pendingSync: DispatchWorkItem?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Constants.syncMessage else { return }
        // 한 회차가 끝나면 두 기록이 잇달아 적힌다. 한 번만 읽는다.
        pendingSync?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.syncDays() }
        pendingSync = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    /// 웹 화면이 이 기기에 쌓아 둔 기록에서 숫자만 읽는다. 하루치 기록에서는 날짜와 장수, 회차 기록에서는
    /// 장수와 걸린 시간과 직접 적었는지. 줄이는 일은 웹 화면 안에서 하므로 일지 글과 주소는 앱으로 건너오지 않는다.
    /// 한 줄이 깨져 있어도 나머지는 읽는다.
    func syncDays() {
        guard let webView, let current = webView.url?.host, Constants.internalHosts.contains(current) else { return }

        let script = """
        (function () {
          var read = function (key) {
            try { var list = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(list) ? list : []; }
            catch (e) { return []; }
          };
          var whole = function (value) { var n = Math.round(Number(value)); return isFinite(n) && n > 0 ? n : 0; };
          var days = read('\(Constants.daysKey)')
            .filter(function (day) { return day && typeof day.date === 'string'; })
            .slice(-120)
            .map(function (day) { return { date: day.date, photos: whole(day.photos) }; });
          var runs = read('\(Constants.runsKey)')
            .filter(function (run) { return run && typeof run === 'object'; })
            .map(function (run) {
              return { photos: whole(run.photos), ms: whole(run.visionMs) + whole(run.firstPassMs), manual: run.mode === 'manual' };
            });
          return JSON.stringify({ days: days, runs: runs });
        })()
        """

        webView.evaluateJavaScript(script) { result, error in
            guard error == nil, let raw = result as? String, let data = raw.data(using: .utf8),
                  let parsed = try? JSONDecoder().decode(RawSync.self, from: data) else { return }

            let days = parsed.days.map { PatrolDay(date: $0.date, photos: $0.photos) }
            let stats = PatrolStats.of(parsed.runs.map {
                PatrolStats.Run(photos: $0.photos, seconds: $0.ms / 1000, manual: $0.manual)
            })
            let store = SharedDataStore.shared
            if store.days != days || store.stats != stats {
                store.days = days
                store.stats = stats
                WidgetCenter.shared.reloadAllTimelines()
            }
        }
    }

    // MARK: - Helpers

    /// 지금 무언가를 띄울 수 있는 화면. 이미 다른 창이 떠 있으면 nil.
    private func presenter() -> UIViewController? {
        guard let host, host.viewIfLoaded?.window != nil, host.presentedViewController == nil else { return nil }
        return host
    }

    private func say(_ message: String, done: @escaping () -> Void) {
        guard let presenter = presenter() else {
            done()
            return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in done() })
        presenter.present(alert, animated: true)
    }

    private func share(_ file: URL) {
        guard let presenter = presenter() else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }
}
