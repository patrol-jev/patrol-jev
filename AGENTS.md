<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# patrol-jev 규약

## 먼저, 사람에게 묻는 자리

**커밋하지 않는다. 밀지 않는다. 배포하지 않는다.** 파일을 고치는 데까지가 도우미의 몫이다.
`git commit` · `git push` · 서버 배포는 **사람이 직접** 한다. 도우미가 주는 것은 **명령어와 문안**뿐이다.

공개 레포이고 살아 있는 사이트다. 무엇이 언제 나갔는지는 사람이 쥐고 있어야 한다.

### 레포와 사이트는 따로 간다

사이트에 먼저 나간 커밋을 레포에는 나중에 올릴 수 있다. 그래서 로컬 `main` 이 원격보다
앞서 있을 수 있고, 무엇을 미룰지는 사람이 정한다.

- push 문안을 내기 전에 `git log --oneline origin/main..main` 을 먼저 본다.
  미뤄 둔 커밋이 있으면 **`git push` 한 줄을 내지 않는다.** 그 줄은 미룬 것까지 같이 민다.
- 지금 밀 것만 밀 때는 원격 기준 작업 폴더에서 고치고 민다.

```
git worktree add --detach ../patrol-jev-push origin/main
(../patrol-jev-push 에서 고치고 커밋)
git -C ../patrol-jev-push push origin HEAD:main
git worktree remove ../patrol-jev-push
```

- 미뤄 둔 커밋을 밀 때는 `git pull --rebase` 가 먼저다.

**커밋 메시지는 영어로, 두 줄 안에.** 제목 한 줄, 필요하면 본문 한 줄.

```
Fix places shifting when a batch is cut at ten photos

Read the plate side from the first photo when both ends are plates.
```

왜 그렇게 고쳤는지, 무엇을 재 봤는지, 버린 대안은 무엇인지는 **커밋에 적지 않는다.**
그 분량은 이력을 읽는 사람에게 소음이고, 무엇이 바뀌었는지가 오히려 안 보인다.
맥락은 코드 주석과 `docs/` 에 남긴다. 그쪽은 한국어다. 쓰는 사람이 읽을 글이다.

## 긴 줄표를 쓰지 않는다

한국어 글에 `—`(em dash)를 넣지 않는다. 문장이 끝났으면 마침표로 끊고, 이름표 뒤라면
쌍점이나 괄호를 쓴다. 쉼표로 이어도 된다.

```
안 됨   주소판은 자리의 끝이다 — 자리를 증명하려고 찍는 것이니
됨      주소판은 자리의 끝이다. 자리를 증명하려고 찍는 것이니
```

영어 문장에서는 그대로 써도 된다. 모델에게 보내는 지시문(`src/core/judgment.ts`)은
손대지 않는다. 글자 하나가 답을 바꾼다.

**공개 레포다.** 특정 지명·기관명·부서명·사람 이름을 코드·주석·커밋 메시지·예시에 넣지 않는다.
예외는 `LICENSE` 의 저작권자 한 줄(만든 사람의 실명)뿐이다. 소속·기관명은 거기에도 넣지 않는다.
동 고유값은 전부 `patrol.config.json` 한 장으로 나가야 하고, 기본값은 `○○동` 처럼 비워 둔다.

- **판단은 `src/core/judgment.ts` 한 곳에만.** 질문 문장과 문턱값이 흩어지면 사람이 검토할 수 없다.
- **갈래는 넷 고정**: 순찰사항 · 계절특수(풍수해) · 위험시설물 · 모르겠음.
  위험성 등급·폐기물 종류·평가항목·배점은 **일부러 뺐다.** 요청이 오기 전에는 다시 넣지 않는다.
- **문장은 코드가 만든다**(`src/core/report.ts`). 일지 글을 생성 모델에게 맡기지 않는다.
  같은 판정이면 늘 같은 글이 나와야 한다(사진을 읽는 단계는 생성 모델이라 회차마다 다르다).
- **읽을 수 있는 것을 짐작시키지 않는다.** 사진에 찍힌 날짜·시각은 앞 단계가 옮겨 적은 글자에서
  **코드가 읽는다**(`src/core/shot-time.ts`). 「몇 시로 보이니」라고 모델에게 묻지 않는다.
- **주소는 짐작하지 않고 대조한다.** 읽은 주소는 그 동의 도로명 색인(`src/core/roads.ts`)과
  맞춰 본다. 비슷한 도로가 둘 이상이면 고치지 않고, 건물번호는 어떤 경우에도 고치지 않는다.
  찍어서 고친 주소는 안 고친 것만 못하다.
- **모르겠음을 지우지 않는다.** 문턱 아래는 비워 두고 사람에게 넘기는 것이 이 도구의 설계다.
- **화면의 색 규칙**: 무지개빛은 Jev 가 낸 값에만, 회색은 생성 모델과 사람이 적은 값에만.
  다른 데에 쓰면 규칙이 깨진다.
- **모델 없이 도는 길을 깨뜨리지 않는다**(`src/core/manual.ts`). 사람이 채우는 칸은
  **자리와 말 둘뿐**이다. 갈래는 말을 고르면 따라온다. 칸을 하나 더 늘리지 않는다.
  그 화면에는 Jev 값이 없으므로 **무지개도 확률도 막대도 그리지 않는다.**
  사진에서 코드가 가져오는 것은 EXIF 시각 하나뿐이다. 주소판 글자를 코드로 읽으려 들지 않는다.
- **로그를 밖으로 보내는 코드를 넣지 않는다.** README 가 「아무 데도 안 보낸다」고 적고 있다.
- **속도를 말할 때는 잰 값으로만.** 화면 숫자는 그 회차에 실제로 잰 값이어야 한다.
- 키는 서버에서만 읽는다(`readKey`). 브라우저로 내려보내지 않는다.
