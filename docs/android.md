# 안드로이드 앱 (`android/`)

웹 화면을 주소창 없이 여는 껍데기입니다(Trusted Web Activity). 앱 코드는 한 줄도 없고, 설정 파일뿐입니다.
화면은 그 폰의 크롬이 그립니다. 그래서 사진기, 파일 받기, 알림이 웹에서 되던 그대로 됩니다.

## 앱이 하는 것과 안 하는 것

- 첫 주소 하나를 엽니다. 그 사이트가 「이 앱은 내 것」이라고 밝혀 두었으면(아래 **사이트 쪽 한 장**) 주소창이 사라집니다.
- 앱이 따로 받는 권한은 알림 하나입니다. 초과기록의 알림을 이 앱 이름으로 띄울 때만 쓰입니다.
  사진기와 저장 공간은 크롬이 맡으므로 앱이 받지 않습니다.
- 앱이 따로 붙인 통신은 없습니다. 분석 도구도, 광고도 없습니다.
- 아이폰 앱에 있는 위젯은 여기 없습니다. 이 틀에서는 앱이 웹 화면의 기록을 읽을 수 없습니다.

## 빌드

```bash
cd android
./gradlew assembleDebug        # 시험용 apk
./gradlew bundleRelease        # 스토어에 올릴 묶음(aab)
```

윈도우 명령 창에서는 `gradlew.bat` 입니다. 안드로이드 SDK 자리는 `android/local.properties` 에 적습니다(Android Studio 로 열면 저절로 생깁니다).
`android/` 를 고쳐서 밀면 저장소의 Actions 가 같은 빌드를 해 봅니다. 비밀값을 쓰지 않습니다.

## 서명

⚠ **서명에 쓰는 것은 어떤 것도 이 저장소에 두지 않습니다.** 열쇠 파일도, 암호도.

`android/keystore.properties` 를 만들어 네 줄을 적습니다. 이 파일은 `.gitignore` 가 막습니다.

```properties
storeFile=C:/저장소/밖의/경로/upload.jks
storePassword=……
keyAlias=upload
keyPassword=……
```

이 파일이 있으면 `bundleRelease` 가 서명한 묶음을 냅니다. 없으면 서명 없이 짓습니다(빌드 확인용).
열쇠가 없으면 한 번 만듭니다.

```bash
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

## 사이트 쪽 한 장

주소창이 사라지려면 사이트가 `/.well-known/assetlinks.json` 을 내보내야 합니다. 웹 쪽 `public/.well-known/assetlinks.json` 에 둡니다.

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "kr.ai.patrol",
    "sha256_cert_fingerprints": ["스토어의 앱 서명 키 지문", "올리기 키 지문"]
  }
}]
```

- 스토어가 앱을 다시 서명합니다. 그래서 **스토어의 앱 서명 키 지문**이 꼭 들어가야 합니다(플레이 콘솔의 앱 서명 화면에 있습니다).
- 올리기 키 지문은 스토어를 거치지 않고 직접 깐 빌드를 볼 때 필요합니다.
  `keytool -list -v -keystore upload.jks -alias upload` 의 SHA256 줄입니다.
- 지문이 안 맞으면 앱은 열리지만 위에 주소창이 보입니다. 그게 보이면 이 파일을 먼저 봅니다.

## 본인 것으로 올리려면

바꿀 자리는 둘입니다.

1. `app/build.gradle` 의 `applicationId` 와 `namespace`
2. `app/src/main/res/values/strings.xml` 의 주소 셋(`hostName` · `launchUrl` · `assetStatements`)과 `providerAuthority`

## 알아 둘 것

- 버전을 올릴 때는 `app/build.gradle` 의 `versionCode`(1씩 올림)와 `versionName` 을 고칩니다. 같은 `versionCode` 는 두 번 못 올립니다.
- 크롬이 없거나 낡은 폰에서는 주소창이 있는 탭으로 열립니다. 쓰는 데는 지장이 없습니다.
- 크롬과 저장 공간을 같이 씁니다. 크롬에서 쌓은 기록이 앱에서도 보입니다(아이폰 앱은 따로입니다).
