# Cloudflare + GitHub Actions 배포 가이드

## 1. D1

```bash
wrangler login
pnpm --filter @remote-job-radar/worker exec wrangler d1 create remote-job-radar-prod
```

반환된 ID를 `apps/worker/wrangler.jsonc`에 넣습니다.

```bash
pnpm --filter @remote-job-radar/worker exec wrangler d1 migrations apply remote-job-radar-prod --remote
```

## 2. Worker Secret

```bash
cd apps/worker
pnpm exec wrangler secret put INGEST_BEARER_TOKEN
pnpm exec wrangler secret put INGEST_HMAC_SECRET_CURRENT
pnpm exec wrangler secret put INGEST_HMAC_SECRET_PREVIOUS
```

Bearer와 HMAC은 서로 다른 32바이트 이상의 난수로 생성하십시오.

## 3. Custom Domain

`wrangler.jsonc`의 route를 실제 도메인으로 교체합니다. `workers_dev: false`를 유지합니다.

## 4. Cloudflare Access

### 사용자 앱

- 경로: `jobs.example.com/*`
- Action: Allow
- Include: 본인 이메일
- 인증: One-time PIN 또는 IdP

### 내부 API

- 경로: `jobs.example.com/api/internal/*`
- Action: Service Auth
- Include: GitHub Actions용 Service Token

더 구체적인 내부 API 애플리케이션이 전체 앱보다 우선하도록 구성합니다.

## 5. GitHub Secrets

- `APP_BASE_URL`
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`
- `INGEST_BEARER_TOKEN`
- `INGEST_HMAC_SECRET`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

저장소는 공개로 두되 실제 서비스는 계속 Cloudflare Access 뒤에 둡니다. Secret 값이나 실제 토큰을 소스, issue, Actions 로그, artifact에 넣지 마십시오. Pull request workflow에는 배포·수집 Secret을 전달하지 않고, 예약·배포 workflow는 기본 브랜치의 검토된 코드에서만 실행합니다.

공개 저장소의 표준 GitHub-hosted Runner는 무료이며 분(minutes) 한도가 없지만, larger runner·artifact storage 및 일반적인 Actions 실행 제한은 별도입니다. 또한 공개 저장소에 60일간 활동이 없으면 예약 workflow가 자동 비활성화될 수 있으므로 장기 무변경 운영 시 Actions 화면에서 활성 상태를 확인합니다.

## 6. 첫 배포

```bash
pnpm install
pnpm check
pnpm deploy
```

## 7. 운영 점검

- `/api/health`가 `ok: true`인지 확인
- Fast workflow 수동 실행
- source health가 초록색인지 확인
- 잘못된 HMAC 요청이 401인지 확인
- 동일 nonce/batch가 거부되는지 확인
- 실패한 소스가 기존 공고를 닫지 않는지 확인
- Fast/Browser workflow가 각각 12시간 간격으로 활성 상태인지 확인
- 공개 저장소의 최근 활동이 60일을 넘기기 전에 예약 workflow 비활성화 여부 확인
