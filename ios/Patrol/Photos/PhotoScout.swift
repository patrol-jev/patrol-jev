import Foundation
import Photos
import UIKit
import WebKit

/// 사진 보관함에서 **지난번 뒤에 새로 생긴 사진**을 웹 화면에 넘긴다. 앱이 하는 일은 그뿐이다.
///
/// 거르기(캡처 · 근무 시간 밖 · 연속 촬영 · 하루 상한), 얼굴 가리기, 둘째 눈, 기록, 알림 글은 전부 웹 쪽 코드가 한다
/// (`src/ui/photo-scout.tsx`). 앱은 보관함을 읽어 줄인 사본(긴 변 1000 · JPEG)과 찍힌 시각 · 자리 · 이름만 넘기고,
/// 웹이 만든 알림 글을 받아 이 기기에서 띄운다. 원본은 넘기지 않고, 앱이 어디로도 보내지 않는다.
///
/// 캡처(스크린샷)는 여기서 먼저 뺀다. 웹 쪽 규칙도 PNG 를 빼지만, 사본은 JPEG 로 만들어 넘기니 여기서 걸러야 한다.
/// 아이클라우드에만 있어 기기에 없는 사진은 받지 않는다(통신이 생기니까). 다음 번에 기기에 있으면 그때 간다.
///
/// 권한은 「모든 사진」 과 「선택한 사진」 둘 다 받아들인다. 선택한 사진이면 그 안에서만 새 것을 본다.
///
///   { op: "status" }                       → { ok, auth }   auth = granted · limited · denied · notDetermined
///   { op: "enable" }                       → 권한을 묻는다. { ok, auth }
///   { op: "scan", since, max }             → since(ms) 뒤에 생긴 사진을 새 것부터 max 장. { ok, photos: [{ id, name, takenAt, lat, lng, data }], latest }
///   { op: "notify", title, body, path }    → 기기 알림 하나. 누르면 path 를 연다. { ok }
///   { op: "mark", on }                     → 자동 보기를 켰다 · 껐다. 켠 기기만 백그라운드 틈을 잡는다(`BackgroundScout`). { ok }
///   { op: "done", looked, notable }        → 백그라운드에서 찌른 자동 보기가 끝났다. { ok }
final class ScoutBridge: NSObject, WKScriptMessageHandlerWithReply {
    /// 넘기는 사본의 긴 변. 웹 즉시 감지(800)보다 조금 크게 두고 웹이 다시 줄인다.
    static let edge: CGFloat = 1000
    static let maxPhotos = 30
    private static let onKey = "scoutOn"
    private static let latestKey = "scoutLatest"
    private static var defaults: UserDefaults { UserDefaults(suiteName: Constants.appGroupID) ?? .standard }

    /// 웹이 자동 보기를 켜 두었는가. 백그라운드 틈은 이 기기만 잡는다.
    static var isOn: Bool {
        get { defaults.bool(forKey: onKey) }
        set { defaults.set(newValue, forKey: onKey) }
    }

    /// 마지막으로 넘긴 사진 가운데 가장 늦은 시각(ms). 백그라운드에서 「새 사진이 있나」 를 셀 때 기준.
    static var lastLatest: Double {
        get { defaults.double(forKey: latestKey) }
        set { defaults.set(newValue, forKey: latestKey) }
    }

    /// since 뒤에 생긴 사진(캡처 제외) 수. 사본은 안 만든다. 백그라운드에서 「돌릴 일이 있나」 만 본다.
    static func newCount(since: Double) -> Int {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else { return 0 }
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d AND creationDate > %@", PHAssetMediaType.image.rawValue, Date(timeIntervalSince1970: since / 1000) as NSDate)
        options.fetchLimit = maxPhotos
        var count = 0
        PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, _ in
            if !asset.mediaSubtypes.contains(.photoScreenshot) { count += 1 }
        }
        return count
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame, Constants.internalHosts.contains(message.frameInfo.securityOrigin.host),
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(["ok": false], nil)
            return
        }

        switch op {
        case "status":
            replyHandler(["ok": true, "auth": Self.authName(PHPhotoLibrary.authorizationStatus(for: .readWrite))], nil)
        case "enable":
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                DispatchQueue.main.async {
                    replyHandler(["ok": true, "auth": Self.authName(status)], nil)
                }
            }
        case "scan":
            let since = body["since"] as? Double ?? 0
            let max = min(Self.maxPhotos, body["max"] as? Int ?? Self.maxPhotos)
            scan(since: since, max: max) { photos, latest in
                Self.lastLatest = Swift.max(Self.lastLatest, latest)
                replyHandler(["ok": true, "photos": photos, "latest": latest], nil)
            }
        case "mark":
            Self.isOn = body["on"] as? Bool ?? false
            if Self.isOn, Self.lastLatest == 0 { Self.lastLatest = Date().timeIntervalSince1970 * 1000 }
            BackgroundScout.shared.schedule()
            replyHandler(["ok": true], nil)
        case "done":
            BackgroundScout.shared.done()
            replyHandler(["ok": true], nil)
        case "notify":
            let title = (body["title"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            let text = (body["body"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            let path = body["path"] as? String ?? "/risk"
            guard !title.isEmpty else {
                replyHandler(["ok": false], nil)
                return
            }
            AlarmCenter.shared.notifyNow(title: title, body: text, path: path) { ok in
                replyHandler(["ok": ok], nil)
            }
        default:
            replyHandler(["ok": false], nil)
        }
    }

    private static func authName(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .limited: return "limited"
        case .denied, .restricted: return "denied"
        default: return "notDetermined"
        }
    }

    /// since 뒤에 생긴 사진(캡처 제외)을 새 것부터 max 장. 사본은 기기에 있는 것만 만든다.
    private func scan(since: Double, max: Int, done: @escaping ([[String: Any]], Double) -> Void) {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            done([], since)
            return
        }
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d AND creationDate > %@", PHAssetMediaType.image.rawValue, Date(timeIntervalSince1970: since / 1000) as NSDate)
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = max * 2
        let found = PHAsset.fetchAssets(with: options)

        var assets: [PHAsset] = []
        found.enumerateObjects { asset, _, stop in
            if asset.mediaSubtypes.contains(.photoScreenshot) { return }
            assets.append(asset)
            if assets.count >= max { stop.pointee = true }
        }
        let latest = assets.first?.creationDate.map { $0.timeIntervalSince1970 * 1000 } ?? since

        let manager = PHImageManager.default()
        let request = PHImageRequestOptions()
        request.deliveryMode = .highQualityFormat
        request.resizeMode = .exact
        request.isNetworkAccessAllowed = false
        request.isSynchronous = false

        var photos: [[String: Any]] = []
        let group = DispatchGroup()
        let lock = NSLock()
        for asset in assets {
            group.enter()
            let side = Self.edge
            let w = CGFloat(asset.pixelWidth), h = CGFloat(asset.pixelHeight)
            let scale = min(1, side / Swift.max(w, h))
            let target = CGSize(width: Swift.max(1, w * scale), height: Swift.max(1, h * scale))
            manager.requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: request) { image, info in
                defer { group.leave() }
                // 흐린 미리보기가 먼저 오는 수가 있다. 마지막(또렷한) 것만 받는다.
                if let degraded = info?[PHImageResultIsDegradedKey] as? Bool, degraded { return }
                guard let image, let data = image.jpegData(compressionQuality: 0.8) else { return }
                var one: [String: Any] = [
                    "id": asset.localIdentifier,
                    "name": Self.fileName(of: asset),
                    "takenAt": asset.creationDate.map { $0.timeIntervalSince1970 * 1000 } ?? 0,
                    "data": data.base64EncodedString(),
                ]
                if let location = asset.location {
                    one["lat"] = location.coordinate.latitude
                    one["lng"] = location.coordinate.longitude
                } else {
                    one["lat"] = NSNull()
                    one["lng"] = NSNull()
                }
                lock.lock()
                photos.append(one)
                lock.unlock()
            }
        }
        group.notify(queue: .main) {
            // 새 것부터.
            photos.sort { ($0["takenAt"] as? Double ?? 0) > ($1["takenAt"] as? Double ?? 0) }
            done(photos, latest)
        }
    }

    /// 원래 파일 이름(IMG_1234.HEIC). 없으면 식별자로. 웹 쪽은 이름으로 결과를 맞춘다.
    private static func fileName(of asset: PHAsset) -> String {
        let resources = PHAssetResource.assetResources(for: asset)
        if let original = resources.first(where: { $0.type == .photo }) ?? resources.first {
            let name = original.originalFilename
            if !name.isEmpty { return name }
        }
        return asset.localIdentifier.replacingOccurrences(of: "/", with: "-") + ".jpg"
    }
}
