# Cloudflare + GitHub Actions 배포 가이드

코드는 별도 도메인 없이 `workers.dev`로 배포하도록 설정되어 있습니다. 아래 Cloudflare 계정 작업은 코드 구현과 로컬 검증 이후로 미뤄도 됩니다. 다만 `apps/worker/wrangler.jsonc`의 `database_id` placeholder를 실제 값으로 바꾸기 전에는 원격 마이그레이션이나 배포를 실행하지 마십시오.

## 1. workers.dev와 D1

Cloudflare Dashboard에서 계정의 `workers.dev` 서브도메인을 활성화하거나 확인합니다. `wrangler.jsonc`는 `workers_dev: true`이고 Custom Domain route가 없는 상태입니다.

```bash
wrangler login
pnpm --filter @remote-job-radar/worker exec wrangler d1 create remote-job-radar-prod
```

반환된 ID로 `apps/worker/wrangler.jsonc`의 `REPLACE_WITH_D1_DATABASE_ID`를 교체합니다.

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

## 3. 배포 주소

첫 배포 후 주소는 다음 형태입니다.

```text
https://remote-job-radar.<계정-subdomain>.workers.dev
```

Custom Domain은 필수가 아닙니다. 나중에 사용할 때만 `wrangler.jsonc`에 route를 추가하고 Cloudflare에서 도메인을 연결합니다.

## 4. Cloudflare Access

### 사용자 앱

- 경로: `remote-job-radar.<계정-subdomain>.workers.dev/*`
- Action: Allow
- Include: 본인 이메일
- 인증: One-time PIN 또는 IdP

### 내부 API

- 경로: `remote-job-radar.<계정-subdomain>.workers.dev/api/internal/*`
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

배포된 정적 SPA에는 `apps/web/public/_headers`의 CSP, 클릭재킹 방지, MIME sniffing 방지, 권한 제한 및 `noindex` 정책이 적용됩니다. GitHub Secrets의 `APP_BASE_URL`에는 위 `workers.dev` 배포 주소를 넣습니다.

## 7. 운영 점검

- `/api/health`가 `ok: true`인지 확인
- Fast workflow 수동 실행
- source health가 초록색인지 확인
- 잘못된 HMAC 요청이 401인지 확인
- 동일 nonce/batch가 거부되는지 확인
- 실패한 소스가 기존 공고를 닫지 않는지 확인
- Fast/Browser workflow가 각각 12시간 간격으로 활성 상태인지 확인
- 공개 저장소의 최근 활동이 60일을 넘기기 전에 예약 workflow 비활성화 여부 확인
