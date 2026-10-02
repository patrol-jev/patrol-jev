# 아이폰 앱 (`ios/`)

웹 화면을 그대로 여는 얇은 껍데기입니다. 판단도, 묶기도, 일지 문장도 전부 웹 쪽 코드가 합니다.
앱이 따로 하는 일은 셋뿐이고, 스토어에 올라가는 앱은 이 폴더에서 빌드합니다.

## 앱이 대신 하는 것

| | 왜 |
|---|---|
| 파일 받기 | 한글 파일, 묶음 파일, 그림은 화면 안에서 만들어 내려받습니다. 앱 안의 웹 화면은 그것을 저절로 받지 못해서, 앱이 받아 공유 창(파일에 저장, 다른 앱으로 보내기)으로 넘깁니다. |
| 밖으로 나가는 주소 | 이 앱은 한 사이트만 엽니다. 다른 주소는 사파리로 넘깁니다. |
| 위젯 | 이번 달에 일지를 며칠 만들었는지, 오늘 만들었는지를 홈 화면과 잠금 화면에 적습니다. |

## 앱이 읽는 것과 안 읽는 것

- 위젯에 적으려고 웹 화면의 기록에서 **날짜와 그날의 사진 장수**만 읽습니다(`WebViewCoordinator.syncDays`).
  일지 글, 주소, 사진은 읽지 않습니다. 읽은 값은 그 기기에만 있고 어디로도 보내지 않습니다.
- 앱이 따로 붙인 통신은 없습니다. 분석 도구도, 광고도, 계정도 없습니다.
- 권한은 둘입니다. 사진기(바로 찍어 올릴 때)와 사진 보관함에 저장(만든 그림을 저장할 때). 위치 권한은 쓰지 않습니다.

## 폴더

```
ios/
  project.yml          프로젝트 정의. Xcode 프로젝트 파일은 여기서 만들고 저장소에 두지 않습니다
  Patrol/              앱. 웹 화면, 파일 받기, 못 열었을 때의 안내
  PatrolWidget/        위젯
  Patrol/Shared/       앱과 위젯이 같이 쓰는 값(주소, 날짜와 장수)
  fastlane/            인증서 맞추기, 빌드, TestFlight 올리기
```

## 빌드

맥이 없어도 됩니다. 저장소의 Actions 가 맥에서 돌립니다(`.github/workflows/ios-build.yml`).

- `ios/` 를 고쳐서 밀면 **서명 없이 빌드만** 해 봅니다. 비밀값을 쓰지 않습니다.
- 서명 빌드와 TestFlight 올리기는 Actions 화면에서 손으로 누릅니다(`build` · `testflight`).

맥이 있으면 이렇게 봅니다.

```bash
cd ios && brew install xcodegen && xcodegen generate && open Patrol.xcodeproj
```

## 본인 것으로 올리려면

받아서 본인 사이트를 여는 앱으로 올릴 수 있습니다. 바꿀 자리는 넷입니다.

1. `Patrol/Shared/Constants.swift` 의 주소와 앱 그룹 이름
2. `project.yml` 의 번들 식별자(앱, 위젯)
3. `Patrol/Patrol.entitlements` · `PatrolWidget/PatrolWidget.entitlements` 의 앱 그룹 이름
4. `fastlane/Appfile` · `Matchfile` · `Fastfile` 의 번들 식별자

그리고 저장소 Secrets 에 여섯 개를 넣습니다.

| 이름 | 무엇 |
|---|---|
| `APPLE_TEAM_ID` | 개발자 팀 ID |
| `ASC_KEY_ID` · `ASC_ISSUER_ID` | App Store Connect API 키의 두 값 |
| `ASC_KEY_CONTENT` | 그 키 파일(`.p8`)을 base64 로 바꾼 것 |
| `MATCH_GIT_URL` | 인증서를 둘 **비공개** 저장소 주소(읽고 쓸 수 있는 토큰 포함) |
| `MATCH_PASSWORD` | 그 저장소의 인증서를 잠그는 암호 |

차례는 이렇습니다. 「iOS init certificates」 한 번 → `build` 로 서명 빌드 확인 → `testflight`.

⚠ **서명에 쓰는 것은 어떤 것도 이 저장소에 두지 않습니다.** 키 파일, 인증서, 프로파일, 인증서 저장소 주소 전부입니다.
`ios/.gitignore` 가 막고 있지만, 올리기 전에 `git status` 로 한 번 더 봅니다.

## 알아 둘 것

- 버전을 올릴 때는 `project.yml` 의 `MARKETING_VERSION` 과 `CURRENT_PROJECT_VERSION` 을 고칩니다.
  같은 빌드 번호는 두 번 못 올립니다.
- 웹 화면의 하루치 기록 열쇠(`src/ui/usage.ts` 의 `DAYS`)를 바꾸면 `Constants.daysKey` 도 같이 바꿉니다.
  안 맞으면 위젯 숫자가 0 에 머뭅니다.
- 앱 안의 웹 화면은 사파리와 저장 공간이 다릅니다. 사파리에서 쌓은 기록은 앱에 안 보입니다.
  옮기려면 사파리에서 「기록 내보내기」로 받은 파일을 앱에서 「가져오기」 합니다.
