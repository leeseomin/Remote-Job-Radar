# Remote Job Radar

Remote·Async-first·Frontend/Product·Three.js/WebGL/WebGPU 채용 공고를 수집하고 개인적으로 판정·관리하는 MVP입니다. 코드는 공개 저장소에서 운영하고, 실제 앱과 내부 API는 Cloudflare Access로 보호하는 구성을 전제로 합니다.

원본 요구사항과 운영 근거는 [`docs/REFERENCE_DESIGN_KO.md`](docs/REFERENCE_DESIGN_KO.md)에 함께 보존했습니다.

핵심 배치는 다음과 같습니다.

- **GitHub Actions 공개 저장소 표준 Runner:** 12시간 주기 외부 요청, HTML/JSON 파싱, Crawlee/Playwright, 정규화, 판정, 점수 계산
- **Cloudflare Worker + Hono:** Access 뒤의 API, HMAC/nonce/idempotency 검증, D1 저장·조회
- **Cloudflare D1:** 공고, 변경 이력, 사용자 상태, 소스 상태, FTS5
- **Vue 3 SPA:** 3열 Job Radar, 검색/필터, 상세 근거, Save/Dismiss/Applied, 소스 상태

## 구현 범위

- Greenhouse, Lever, Ashby, JSON-LD, 정적 HTML, Crawlee Playwright 어댑터
- HTTP 조건부 요청(ETag/Last-Modified), 5MB 상한, timeout/retry, SSRF 차단
- 한국 지원 가능성, Remote 범위, Async 신호, 역할·그래픽 기술 적합도, 100점 모델
- 10개 이하/256KB 이하 ingest 배치
- Access Service Token 헤더 + Bearer + HMAC-SHA256 + timestamp + nonce + idempotency
- 정상 완료와 `not_modified`를 구분하고, 연속 2회 누락 때만 마감
- 정규화된 source fingerprint가 같으면 내용 UPSERT를 생략하면서 누락 판정은 계속 수행
- 비정상 run 종료 시 완료되지 않은 source lease를 해제하고 12시간 뒤 재시도
- 0건/80% 급감/캡차/로그인/영구 HTTP 오류는 quarantine, 408·425·429·5xx는 재시도
- D1 FTS5와 cursor pagination
- 데모 시드와 Worker/domain/crawler 테스트

## 빠른 시작

요구 사항은 Node.js 24 LTS, pnpm 10, Git입니다.

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
./build.sh
```

- Vue: `http://localhost:5173`
- Worker: `http://localhost:8787`
- Vite가 `/api`를 Worker로 프록시합니다.
- `./build.sh`는 의존성 설치, 로컬 D1 마이그레이션·데모 시드, 전체 검사·빌드를 마친 뒤 개발 서버를 실행합니다.
- 서버를 실행하지 않고 검사와 빌드까지만 수행하려면 `./build.sh --check-only`를 사용합니다.
- 기존 `.dev.vars`와 로컬 D1을 삭제하지 않으며, 데모 시드는 기존 레코드를 덮어쓰지 않습니다.

`pnpm-lock.yaml`은 공개 저장소에 함께 커밋하고 CI에서는 `--frozen-lockfile`로 설치합니다.

## 공개 저장소 운영 전제

[GitHub 공식 정책](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)상 공개 저장소의 표준 GitHub-hosted Runner는 무료이며 분(minutes) 한도가 없습니다. larger runner는 이 조건에 포함되지 않습니다. 크롤러는 `ubuntu-latest` 표준 Runner만 사용합니다.

- Fast 수집: 매일 `00:17`, `12:17` UTC (`09:17`, `21:17` KST)
- Browser 수집: 매일 `00:43`, `12:43` UTC (`09:43`, `21:43` KST)
- 새 소스 기본 수집 간격: 720분
- 저장소는 공개이지만 배포 URL, Access 토큰, ingest secret은 GitHub Actions Secret에만 둡니다.
- [공개 저장소에 60일 동안 활동이 없으면](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) GitHub가 예약 workflow를 자동 비활성화할 수 있습니다. 장기 무변경 운영 시 Actions 화면에서 활성 상태를 점검하고 필요하면 다시 활성화합니다.

크롤링 실행 흐름은 다음과 같습니다.

```text
GitHub Actions (12h)
  -> Worker crawl plan / lease
  -> ATS API + SafeHttpClient | HTML + Cheerio | JS + Crawlee PlaywrightCrawler
  -> Normalize -> source-scoped dedupe/content hash -> source fingerprint
  -> changed: signed/idempotent Worker ingest -> D1
  -> unchanged: content UPSERT skip -> presence/missing-state update only
```

Crawlee는 실행 인프라가 아니라 Runner 안에서 동작하는 라이브러리입니다. D1만 영속 저장소로 사용하며 Crawlee의 queue/storage는 해당 Actions run 안에서만 사용합니다.

## 로컬 크롤러

Worker가 실행 중이고 `.env`가 설정되어 있을 때:

```bash
export APP_BASE_URL=http://localhost:8787
export INGEST_BEARER_TOKEN=local-development-token
export INGEST_HMAC_SECRET=local-development-hmac-secret-change-me
pnpm crawl:fast
```

Cloudflare Access가 없는 로컬 실행에서는 Access 헤더가 비어 있어도 됩니다. 운영에서는 반드시 Service Token을 설정합니다.

## Cloudflare 배포

저장소는 별도 도메인 없이 `workers.dev`로 먼저 배포하도록 준비되어 있습니다. 아래 Cloudflare 계정 작업은 코드 구현과 로컬 검증을 마친 뒤 진행해도 됩니다. `database_id` placeholder가 남아 있는 동안 원격 배포는 실행하지 마십시오.

1. Cloudflare Dashboard에서 계정의 `workers.dev` 서브도메인을 활성화하거나 확인합니다.
2. D1 생성

```bash
pnpm --filter @remote-job-radar/worker exec wrangler d1 create remote-job-radar-prod
```

3. `apps/worker/wrangler.jsonc`의 `database_id` placeholder를 반환된 실제 ID로 교체합니다.
4. 마이그레이션 적용

```bash
pnpm --filter @remote-job-radar/worker exec wrangler d1 migrations apply remote-job-radar-prod --remote
```

5. Secret 설정

```bash
cd apps/worker
pnpm exec wrangler secret put INGEST_BEARER_TOKEN
pnpm exec wrangler secret put INGEST_HMAC_SECRET_CURRENT
pnpm exec wrangler secret put INGEST_HMAC_SECRET_PREVIOUS
```

6. `pnpm deploy`를 실행하고 출력된 `https://remote-job-radar.<계정-subdomain>.workers.dev` 주소를 확인합니다.
7. Cloudflare Access에서 해당 `workers.dev` 호스트 전체의 사용자 앱과 `/api/internal/*`의 Service Auth 앱을 각각 구성합니다.
8. 배포 URL과 Cloudflare·Access 자격 증명을 GitHub Actions Secrets에 등록합니다.

정적 SPA에는 `apps/web/public/_headers`의 CSP·보안 헤더·검색엔진 차단 정책이 함께 배포됩니다. Custom Domain은 이후 필요할 때만 `routes`를 추가해 전환할 수 있습니다.

상세 절차는 [`docs/DEPLOY_KO.md`](docs/DEPLOY_KO.md)를 참고하십시오.

## 소스 추가

UI의 **Sources**에서 다음 정보를 입력합니다.

- Greenhouse: `adapter_key`에 board token
- Lever: `adapter_key`에 site name
- Ashby: `adapter_key`에 job board name
- JSON-LD: 공개 채용 목록 URL
- static-html/playwright: URL과 selector JSON

JavaScript 렌더링이 필요한 소스는 adapter를 `playwright`로 명시합니다. `browser_required`는 adapter에서 자동 파생되며, HTTP 오류·403·429·캡차를 브라우저나 proxy로 우회하는 자동 fallback은 사용하지 않습니다.

기존 source ID는 같은 논리적 채용 피드의 연결 정보 수정에만 사용합니다. 전혀 다른 기업·채용 보드로 바꿀 때는 기존 source를 일시정지하고 새 source를 만들어야 저장·지원 상태와 공고 변경 이력이 다른 공고에 이어 붙지 않습니다.

예시 selector JSON:

```json
{
  "listSelector": ".job-card",
  "titleSelector": ".job-title",
  "locationSelector": ".job-location",
  "linkSelector": "a",
  "detailDescriptionSelector": ".job-description"
}
```

## 검증

의존성 설치 후:

```bash
pnpm check
```

생성 환경에서 수행한 오프라인 검증은 `VALIDATION.md`에 기록되어 있습니다.

## 안전·정책

공개 채용 정보만 수집합니다. 로그인, 캡차 우회, 차단 회피 프록시, 지원서 제출 엔드포인트 호출은 구현하지 않았습니다. URL은 SSRF 방어를 거치며 리다이렉트마다 재검증합니다.
