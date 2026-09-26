# patrol-jev

**사진을 올린다 → 순찰일지 글이 나온다 → 한글 파일(.hwpx)로 받거나 본인 부서 양식에 붙인다.** 딱 이만큼입니다.
한 달이 지나면 그 일지들을 모아 **결과 보고서**(글 · 한글 파일)로 셉니다. 순위나 평가는 없고, 숫자와 자리뿐입니다.

사진을 자리별로 묶고, 주소판을 읽어 옮겨 적고, 문장으로 만드는 일까지 자동화 합니다.
판단이 필요한 대목은 담당자가 채웁니다.

**[patrol.ai.kr](https://patrol.ai.kr)**
테스트 페이지에서도 이용 가능하나, 하루 한도가 정해져 있습니다. 제한 없이 쓰시려면 받아서 쓰세요.

```bash
git clone https://github.com/patrol-jev/patrol-jev.git && cd patrol-jev
npm install && cp .env.example .env.local   # 키 두 개를 넣습니다
npm run dev                                 # http://localhost:3000
```

키는 둘입니다. [OpenAI](https://platform.openai.com)가 사진을 글로 옮기고,
[Jev](https://console.typesafe.ai)가 그 글을 네 갈래 중 하나로 가릅니다. 묶기와 문장은 코드가 합니다.

**키가 없어도 씁니다.** 화면 위에서 「직접 적어서」를 고르면 모델을 한 번도 안 부릅니다.
사진이 이 브라우저를 벗어나지 않고, 비용도 0 입니다. 묶기·시각·일지 문장은 그대로 나옵니다.
개인정보를 다루지 않습니다. 계정도 데이터베이스도 없고, 기록은 그 컴퓨터에만 남습니다. MIT.

어떻게 도는지, 본인 동에 맞추는 법, 속도와 정확도 실측은 **[docs/guide.md](docs/guide.md)** 에 있습니다.
