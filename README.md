# API 잔액 위젯 (마리나라 확장)

*[English guide here](./README.en.md)*

마리나라 화면에 뜨는 **💰 버튼** 하나로 **DeepSeek 잔액**과 **OpenRouter
크레딧**을 확인하는 확장입니다. 버튼은 드래그로 옮길 수 있고, 잔액은 1분
간격으로 캐시됩니다.

Claude(Anthropic) 사용액은 확장으로는 확인할 수 없어서(아래 참고) 동봉된
CLI 스크립트 `balance.mjs`가 대신합니다.

## 버전 호환

| Marinara 버전 | 사용할 릴리스 |
|---|---|
| **2.5.2 (2026-11-06 QA 검증)** | **v2.0.1** — 현재 소스 / 이 README 기준 |
| 2.3.3 이하 | v1.0.0 (legacy, pre-release 표시) |
| 2.3.4 | 확장 시스템이 없어 사용 불가 |

## ⚠️ API 키 취급 — 설치 전에 읽어주세요

정직하게 알려드립니다:

- 키는 잔액 조회를 위해 **각 제공자(DeepSeek / OpenRouter)로만** 전송됩니다.
  그 외 어디로도 보내지 않습니다.
- 키는 **여러분의 마리나라 서버 DB에 평문으로 저장**됩니다 (마리나라의 확장
  저장소가 암호화를 제공하지 않습니다). 그래서 **프로필 내보내기(export)
  ZIP에 키가 포함될 수 있습니다** — 내보낸 파일을 남에게 줄 때 주의하세요.
- 잔액 조회 전용 키를 따로 만들어 쓰는 것을 권합니다 (OpenRouter는 키별
  한도 설정 가능).

## 설치 (Marinara 2.5.2, 안전장치 4단계)

1. **`.env` 게이트**: 설치 폴더의 `.env`에 `ENABLE_EXTERNAL_EXTENSIONS=true`
   추가 후 재시작
> **🐳 도커로 쓰시는 경우** — `.env` 대신 `docker-compose.yml` 파일을 엽니다.
> `environment:` 줄을 찾아 그 **아래에 한 줄만** 추가하세요 (다른 줄과 앞 칸을 맞춰서):
>
> ```yaml
>       - ENABLE_EXTERNAL_EXTENSIONS=true
> ```
>
> 저장한 뒤 `docker compose up -d` 를 실행하면 적용됩니다.
> 다른 기기 브라우저로 접속해 쓰신다면 같은 자리에
> `- ADMIN_SECRET=원하는비밀값` 도 한 줄 추가하세요 (위험 구역을 열 때 필요).
> 적용됐는지 확인하려면:
>
> ```sh
> docker compose exec marinara env | grep ENABLE_EXTERNAL
> ```
>
> 값이 나오면 적용된 것이고, 안 나오면 `docker compose up -d` 를 한 번 더 실행하세요.

2. **앱 게이트**: **Settings**(설정) → **Advanced**(고급) → **Danger Zone**
   (위험 구역) → **Allow third-party extension imports**(서드파티 확장
   가져오기 허용) 켜기
3. **가져오기**: 아래의 GitHub 설치 도우미를 쓰거나, 현재 소스로 만든 ZIP을
   **Settings → Addons**(애드온) → **External Extensions**(외부 확장)에서
   **Import Extension File**로 **압축 그대로** 가져오기. 폴더로 설치하려면
   **Import Extension Folder**로 `manifest.json`과 `extension.js`가 들어 있는
   `extension` 폴더를 선택하세요. ZIP 만드는 법은 아래를 참고하세요.
4. **승인**: 전원 아이콘 → **"전체 페이지 접근"** 승인 창 → **"이 코드
   그대로 실행"** *(확장 파일이 갱신되면 같은 창이 다시 뜹니다 — 정상입니다)*

## GitHub로 설치

Marinara 2.5.2의 **External Extensions**(외부 확장)에는
**Import Extension File**과 **Import Extension Folder**만 있으며,
GitHub 설치 입력란은 없습니다. GitHub로 설치하려면 위의 확장 가져오기 허용
설정을 마친 뒤 아래 GitHub 설치 도우미 확장 중 하나를 설치하고 활성화하세요.

- [**ME.Fetchy**](https://github.com/FigCake/ME.Fetchy): 해당 확장의 GitHub 설치
  입력란에 아래 경로를 그대로 입력하세요:

  ```text
  mallang0723/ME-BalanceWidget/extension
  ```

- [**GitHub 확장 관리자**](https://github.com/f-en-rep/Marinara-GitHub-Manager):
  저장소 기본 주소만 입력합니다(`/tree/main/...` 경로는 붙이지 않습니다).

  ```text
  https://github.com/mallang0723/ME-BalanceWidget
  ```

  이어서 "설치 대상 선택"에서 `extension/manifest.json` 항목을 고릅니다.

설치 후 **전체 페이지 접근**을 승인하고 활성화하세요. 화면에 버튼과 패널을
추가하는 데 필요한 기존 권한이며, 이번 변경으로 추가되는 권한은 없습니다.

ZIP 수동 가져오기를 쓰려면 현재 소스로 ZIP을 직접 만듭니다.
저장소 루트에서 다음 명령을 실행한 뒤, 생성된 파일을 위의 수동 설치 절차로
가져오세요. ZIP 루트에 `manifest.json`과 `extension.js`가 함께 들어갑니다.

```bash
(cd extension && zip ../marinara-balance-widget.zip manifest.json extension.js)
```

변경 내용은 [변경 이력](./CHANGELOG.md)을 참고하세요.

## 사용법

1. 💰 버튼 클릭 → 패널이 열립니다
2. ⚙ 설정 → DeepSeek / OpenRouter API 키 입력 → 저장
   - 이미 저장된 키는 입력칸에 다시 표시되지 않고 "저장됨" 안내만 뜹니다
   - **빈 채로 저장하면 기존 키가 유지**되고, 새로 입력한 것만 교체됩니다
3. 잔액이 표시됩니다. ↻ 새로고침은 1분 캐시를 무시하고 즉시 조회합니다

| 표시 | 뜻 |
|---|---|
| 키 오류(만료·권한 확인) | 키가 틀렸거나 만료됨 (HTTP 401/403) |
| 속도 제한 — N초 후 재시도 | 제공자 측 요청 제한 (HTTP 429) |
| 키 미설정 | ⚙ 설정에서 키를 넣어주세요 |

## Claude 사용액은 왜 없나요?

Anthropic의 잔액·사용액 API는 **브라우저 접근을 의도적으로 차단**합니다
(관리자용 엔드포인트라서요 — 실측 확인). 확장은 브라우저에서 돌기 때문에
가져올 방법이 없고, 우회하는 것도 옳지 않습니다 (admin 키를 브라우저에
두지 말라는 뜻이니까요).

대신 동봉된 **`balance.mjs`** 를 터미널에서 실행하면 세 곳(DeepSeek /
OpenRouter / Claude 당월 사용액)을 한 번에 보여줍니다:

```bash
node balance.mjs
```

키는 환경변수로만 읽습니다 (`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`,
`ANTHROPIC_ADMIN_KEY` — Claude는 **admin 키**(`sk-ant-admin…`)가 필요하며
일반 API 키로는 조회가 안 됩니다). 어디에도 저장하지 않습니다.

## 라이선스

MIT
