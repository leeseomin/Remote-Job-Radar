# Remote Job Radar

Remote·Async-first·Frontend/Product·Three.js/WebGL/WebGPU 채용 공고를 수집하고 개인적으로 판정·관리하는 비공개 MVP입니다.

원본 요구사항과 운영 근거는 [`docs/REFERENCE_DESIGN_KO.md`](docs/REFERENCE_DESIGN_KO.md)에 함께 보존했습니다.

핵심 배치는 다음과 같습니다.

- **GitHub Actions:** 외부 요청, HTML/JSON 파싱, Playwright, 정규화, 판정, 점수 계산
- **Cloudflare Worker + Hono:** Access 뒤의 API, HMAC/nonce/idempotency 검증, D1 저장·조회
- **Cloudflare D1:** 공고, 변경 이력, 사용자 상태, 소스 상태, FTS5
- **Vue 3 SPA:** 3열 Job Radar, 검색/필터, 상세 근거, Save/Dismiss/Applied, 소스 상태

## 구현 범위

- Greenhouse, Lever, Ashby, JSON-LD, 정적 HTML, Playwright 어댑터
- HTTP 조건부 요청(ETag/Last-Modified), 5MB 상한, timeout/retry, SSRF 차단
- 한국 지원 가능성, Remote 범위, Async 신호, 역할·그래픽 기술 적합도, 100점 모델
- 20개 이하/512KB 이하 ingest 배치
- Access Service Token 헤더 + Bearer + HMAC-SHA256 + timestamp + nonce + idempotency
- 정상 완료와 `not_modified`를 구분하고, 연속 2회 누락 때만 마감
- 비정상 run 종료 시 완료되지 않은 source lease를 해제하고 quarantine 처리
- 0건/80% 급감/캡차/로그인/HTTP 오류 quarantine
- D1 FTS5와 cursor pagination
- 데모 시드와 Worker/domain/crawler 테스트

## 빠른 시작

요구 사항은 Node.js 24 LTS, pnpm 10, Git입니다.

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

- Vue: `http://localhost:5173`
- Worker: `http://localhost:8787`
- Vite가 `/api`를 Worker로 프록시합니다.

`pnpm install` 후 생성되는 `pnpm-lock.yaml`은 실제 배포 전 저장소에 커밋하십시오. 이 배포본은 네트워크가 없는 생성 환경에서도 검토 가능하도록 소스 중심으로 구성되어 있습니다.

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

1. D1 생성

```bash
pnpm --filter @remote-job-radar/worker exec wrangler d1 create remote-job-radar-prod
```

2. `apps/worker/wrangler.jsonc`의 `database_id`를 교체합니다.
3. 마이그레이션 적용

```bash
pnpm --filter @remote-job-radar/worker exec wrangler d1 migrations apply remote-job-radar-prod --remote
```

4. Secret 설정

```bash
cd apps/worker
pnpm exec wrangler secret put INGEST_BEARER_TOKEN
pnpm exec wrangler secret put INGEST_HMAC_SECRET_CURRENT
pnpm exec wrangler secret put INGEST_HMAC_SECRET_PREVIOUS
```

5. `pnpm deploy`
6. Cloudflare Access에서 사용자 앱 `jobs.example.com/*`와 Service Auth 앱 `jobs.example.com/api/internal/*`를 각각 구성합니다.
7. `workers_dev`는 꺼 둔 채 Custom Domain만 사용합니다.

상세 절차는 [`docs/DEPLOY_KO.md`](docs/DEPLOY_KO.md)를 참고하십시오.

## 소스 추가

UI의 **Sources**에서 다음 정보를 입력합니다.

- Greenhouse: `adapter_key`에 board token
- Lever: `adapter_key`에 site name
- Ashby: `adapter_key`에 job board name
- JSON-LD: 공개 채용 목록 URL
- static-html/playwright: URL과 selector JSON

예시 selector JSON:

```json
{
  "listSelector": ".job-card",
  "titleSelector": ".job-title",
  "locationSelector": ".job-location",
  "linkSelector": "a",
  "detailDescriptionSelector": ".job-description",
  "browserRequired": false
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
