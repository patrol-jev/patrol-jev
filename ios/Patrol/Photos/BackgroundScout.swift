import BackgroundTasks
import Foundation
import UIKit
import WebKit

/// 앱이 꺼져 있을 때의 새 사진 훑기. 시스템이 틈을 줄 때(백그라운드 새로고침) 한 번 깨어나 웹 화면의 자동 보기를 찌른다.
///
/// 때는 iOS 가 정한다(쓰는 습관을 보고 하루 몇 번 · 한 번에 30초 안). 「찍자마자」 는 아니고 「다음에 폰을 볼 때 이미 봐 뒀다」 다.
/// 앱이 하는 일은 셋이다. ① 새 사진이 있는지 세고(없으면 바로 끝) ② 있으면 웹 화면(`window.patrolScoutKick`)을 불러 자동 보기를
/// 돌리고(거르기 · 가리기 · 둘째 눈 · 기록 · 알림 글은 전부 웹) ③ 웹 화면이 죽어 있어 못 부르면 「새 사진 n장 · 열면 봐요」 알림 하나.
///
/// 웹이 「새 사진 자동 보기」 를 켠 기기에서만 잡는다(`ScoutBridge` 의 mark). 꺼져 있으면 잡지 않는다.
/// 식별자는 Info.plist 의 `BGTaskSchedulerPermittedIdentifiers` 와 같아야 한다.
final class BackgroundScout {
    static let shared = BackgroundScout()
    static let taskID = "kr.ai.patrol.scout"
    /// 다음 틈을 이보다 빨리 달라고 하지 않는다. iOS 는 어차피 더 늦게 준다.
    static let earliest: TimeInterval = 30 * 60
    /// 웹이 「done」 을 안 보내면 이만큼 뒤에 끝낸 것으로 본다(시스템 만료가 먼저 오면 그쪽).
    static let waitLimit: TimeInterval = 25

    weak var webView: WKWebView?
    private var task: BGAppRefreshTask?
    private var waiting: DispatchWorkItem?

    /// 앱이 뜰 때 한 번. 등록은 앱이 처음 켜질 때 끝나 있어야 한다.
    func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.taskID, using: nil) { [weak self] task in
            guard let task = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self?.handle(task)
        }
    }

    /// 앱이 뒤로 갈 때마다. 켜 둔 기기만.
    func schedule() {
        guard ScoutBridge.isOn else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskID)
            return
        }
        let request = BGAppRefreshTaskRequest(identifier: Self.taskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: Self.earliest)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // 시뮬레이터나 꺼진 설정(설정 → 일반 → 백그라운드 앱 새로고침)에서는 실패한다. 그러면 앱을 열 때만 돈다.
        }
    }

    private func handle(_ task: BGAppRefreshTask) {
        // 다음 틈을 먼저 잡아 둔다. 이번이 어떻게 끝나든.
        schedule()
        let count = ScoutBridge.newCount(since: ScoutBridge.lastLatest)
        guard count > 0 else {
            task.setTaskCompleted(success: true)
            return
        }
        self.task = task
        task.expirationHandler = { [weak self] in
            self?.finish(success: false, fallback: count)
        }
        DispatchQueue.main.async {
            guard let webView = self.webView else {
                self.finish(success: false, fallback: count)
                return
            }
            // 웹 화면이 살아 있으면 자동 보기를 돌린다. 끝나면 웹이 `patrolScout` 의 done 을 보낸다.
            webView.evaluateJavaScript("typeof window.patrolScoutKick === 'function' ? (window.patrolScoutKick(), true) : false") { result, error in
                let kicked = (result as? Bool) == true && error == nil
                guard kicked else {
                    self.finish(success: false, fallback: count)
                    return
                }
                let limit = DispatchWorkItem { [weak self] in self?.finish(success: false, fallback: count) }
                self.waiting = limit
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.waitLimit, execute: limit)
            }
        }
    }

    /// 웹이 다 했다고 알려 왔다(`{ op: "done" }`).
    func done() {
        finish(success: true, fallback: 0)
    }

    private func finish(success: Bool, fallback: Int) {
        waiting?.cancel()
        waiting = nil
        guard let task else { return }
        self.task = nil
        if !success && fallback > 0 {
            // 웹이 못 돌았다. 사진이 있다는 것만 알린다. 열면 그때 본다.
            AlarmCenter.shared.notifyNow(title: "새 사진 \(fallback)장", body: "열면 위험을 봐요.", path: "/risk") { _ in
                task.setTaskCompleted(success: false)
            }
            return
        }
        task.setTaskCompleted(success: success)
    }
}
