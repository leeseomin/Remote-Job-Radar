# Cloudflare 배포 체크리스트

코드 구현과 로컬 검증은 완료되었습니다. 이제 남은 작업은 Cloudflare 계정 설정, GitHub Secrets, 실제 배포와 운영 확인입니다.

## 현재 상태

- [x] GitHub 저장소 Public 전환 및 `main` 반영
- [x] `workers_dev: true` 및 Custom Domain route 제거
- [x] 정적 자산 `_headers` 추가
- [x] production sourcemap 비활성화
- [x] ingest 10건·256KB 적용
- [x] source fingerprint와 D1 migration `0003` 구현
- [ ] 실제 D1 생성 및 `database_id` 교체
- [ ] Cloudflare·Access·GitHub Secrets 등록
- [ ] 원격 migration과 첫 배포
- [ ] Fast/Browser workflow 실수집 확인

현재 `apps/worker/wrangler.jsonc`에는 다음 placeholder가 남아 있습니다.

```json
"database_id": "REPLACE_WITH_D1_DATABASE_ID"
```

최신 Deploy workflow는 코드 문제가 아니라 GitHub의 `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`가 비어 있어 원격 migration 단계에서 실패한 상태입니다.

---

## 1. Zero Trust와 workers.dev 확인

- [ ] Cloudflare 계정에서 Zero Trust 초기 설정을 완료
- [ ] One-time PIN 또는 사용할 IdP를 활성화
- [ ] Workers & Pages에서 계정의 `workers.dev` 서브도메인을 확인

예상 주소:

```text
https://remote-job-radar.<계정-subdomain>.workers.dev
```

코드에는 이미 다음 설정이 반영되어 있으므로 Custom Domain은 필요하지 않습니다.

```json
"workers_dev": true
```

참고: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/

---

## 2. D1 데이터베이스 생성

- [ ] 로컬에서 Cloudflare 로그인

```bash
pnpm --filter @remote-job-radar/worker exec wrangler login
```

- [ ] D1 생성

```bash
pnpm --filter @remote-job-radar/worker exec \
  wrangler d1 create remote-job-radar-prod
```

한국 중심으로 둘 경우 생성 시 `--location=apac`을 선택적으로 지정할 수 있습니다.

- [ ] 반환된 UUID를 `apps/worker/wrangler.jsonc`의 `database_id`에 입력
- [ ] GitHub의 Cloudflare 배포 Secret이 준비될 때까지 변경을 로컬에 유지

`database_id`는 Secret이 아니므로 공개 저장소에 커밋해도 됩니다.

---

## 3. GitHub 배포용 Cloudflare API Token

- [ ] Cloudflare에서 API Token 생성
- [ ] 가능하면 대상 Cloudflare 계정 하나로 resource scope 제한
- [ ] Global API Key 대신 제한된 API Token 사용

필수 권한:

```text
Workers Scripts: Edit
D1: Edit
```

Cloudflare UI의 현재 표기가 `Write`라면 같은 쓰기 권한을 선택합니다. `Edit Cloudflare Workers` 템플릿을 사용한 경우에도 `D1: Edit` 권한을 별도로 확인해야 합니다.

GitHub Repository Secrets에 먼저 등록:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

이 두 값은 `.github/workflows/deploy.yml`의 원격 migration과 Worker 배포에 사용됩니다.

참고:

- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://developers.cloudflare.com/d1/platform/release-notes/

---

## 4. 원격 migration과 첫 배포

D1 ID와 위 GitHub Secrets가 준비된 뒤 다음 중 하나를 실행합니다.

- [ ] 실제 D1 ID 변경을 커밋·push

### 방법 A: GitHub Actions

- [ ] push로 자동 시작된 `Deploy Cloudflare Worker`를 확인하거나 Actions에서 `Run workflow`로 재실행

이 workflow는 다음을 순서대로 수행합니다.

```text
pnpm check
원격 D1 migration
production build
Worker deploy
```

### 방법 B: 로컬

```bash
pnpm --filter @remote-job-radar/worker exec \
  wrangler d1 migrations apply remote-job-radar-prod --remote

pnpm deploy
```

- [ ] migration 적용 상태 확인

```bash
pnpm --filter @remote-job-radar/worker exec \
  wrangler d1 migrations list remote-job-radar-prod --remote
```

- [ ] 배포 출력에서 최종 `workers.dev` 주소 확인

첫 배포 직후 D1에는 사용자 데이터가 없으며, Worker Secret과 Access를 설정하기 전에는 실제 수집 workflow를 실행하지 않습니다.

---

## 5. Cloudflare Access 설정

첫 배포로 Worker가 생성되면 즉시 Access를 적용합니다.

### 5.1 사용자 앱 전체 보호

- [ ] Workers & Pages → `remote-job-radar` → Access
- [ ] `Protect this Worker behind Access`
- [ ] Traffic scope는 `All traffic`
- [ ] Allow 정책에는 본인 이메일만 Include
- [ ] One-time PIN 또는 선택한 IdP로 로그인 확인

Worker-level Access를 사용하지 않고 hostname application을 만들 경우:

```text
remote-job-radar.<계정-subdomain>.workers.dev/*
```

### 5.2 내부 API Service Auth

- [ ] Zero Trust → Access controls → Service credentials → Service Tokens
- [ ] GitHub Actions용 Service Token 생성
- [ ] Client ID와 Client Secret을 즉시 안전한 곳에 보관
- [ ] 다음 경로에 더 구체적인 Access application 생성

```text
remote-job-radar.<계정-subdomain>.workers.dev/api/internal/*
```

정책:

```text
Action: Service Auth
Include: 방금 만든 GitHub Actions Service Token
```

경로별 Access 정책에서는 더 구체적인 `/api/internal/*` 규칙이 전체 Worker 규칙보다 우선합니다. Service Token을 생성만 하고 정책의 Include에 연결하지 않으면 GitHub Actions가 인증되지 않습니다.

참고:

- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/

---

## 6. Worker Secret 설정

Bearer와 HMAC은 서로 다른 32바이트 이상의 난수를 사용합니다. 공개 저장소, issue, Actions 로그, artifact에 값을 기록하지 않습니다.

```bash
cd apps/worker

pnpm exec wrangler secret put INGEST_BEARER_TOKEN
pnpm exec wrangler secret put INGEST_HMAC_SECRET_CURRENT
```

`INGEST_HMAC_SECRET_PREVIOUS`는 최초 배포에서는 설정하지 않습니다. HMAC 키를 교체할 때만 이전 키를 임시로 등록합니다.

```bash
# 키 교체 기간에만 실행
pnpm exec wrangler secret put INGEST_HMAC_SECRET_PREVIOUS
```

선택적인 이중 방어가 필요하면 본인 이메일을 `USER_EMAIL` Worker Secret으로 등록할 수 있습니다. 기본 보호 경계는 Cloudflare Access의 본인 이메일 Allow 정책입니다.

---

## 7. GitHub Repository Secrets 전체 등록

GitHub → Repository → Settings → Secrets and variables → Actions에 다음 7개를 등록합니다.

```text
APP_BASE_URL
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
INGEST_BEARER_TOKEN
INGEST_HMAC_SECRET
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

값의 정확한 대응 관계:

```text
APP_BASE_URL
= https://remote-job-radar.<계정-subdomain>.workers.dev

CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
= Cloudflare Access Service Token의 Client ID / Client Secret

GitHub INGEST_BEARER_TOKEN
= Worker INGEST_BEARER_TOKEN

GitHub INGEST_HMAC_SECRET
= Worker INGEST_HMAC_SECRET_CURRENT
```

`INGEST_HMAC_SECRET_PREVIOUS`를 GitHub에 등록하는 항목은 없습니다.

---

## 8. 배포 후 기능 확인

### Access

- [ ] 로그아웃 상태에서 `workers.dev` 접속이 차단되거나 로그인 화면으로 이동
- [ ] 본인 이메일 로그인 후 SPA가 정상 표시
- [ ] 다른 이메일은 허용되지 않음

### Worker와 D1

- [ ] 로그인 후 `/api/health`가 `ok: true`
- [ ] D1 migration list에 미적용 migration이 없음
- [ ] 브라우저 개발자 도구에서 CSP·보안 헤더 확인

### 초기 데이터와 크롤링

배포 직후 앱은 빈 상태입니다.

- [ ] UI에서 company를 최소 1개 등록
- [ ] 해당 company에 source를 최소 1개 등록
- [ ] GitHub Actions의 `Crawl fast sources`를 수동 실행
- [ ] Playwright source가 있으면 `Crawl browser sources`도 수동 실행
- [ ] Actions 로그에서 Access·Bearer·HMAC 오류가 없는지 확인
- [ ] UI에서 공고와 source health가 정상 표시되는지 확인

### 유지보수

- [ ] `Cleanup D1 retention` workflow 수동 확인
- [ ] `Backup user data` workflow 수동 확인
- [ ] 공개 저장소가 60일 이상 비활성 상태가 되면 scheduled workflow가 꺼질 수 있으므로 Actions 활성 상태 확인

---

## 9. 배포 후 무료 한도 관측

Cloudflare Dashboard에서 1~2주 관측합니다.

### Workers & Pages → remote-job-radar → Metrics

- Requests
- CPU time
- Errors

### D1 → remote-job-radar-prod → Metrics

- Rows read
- Rows written
- Database size

초기 경고 기준:

```text
Worker CPU p95가 10ms에 지속적으로 근접
D1 rows_written이 100,000/day에 근접
D1 rows_read가 5,000,000/day에 근접
```

무료 한도에 근접하면 source 수, 수집 빈도 또는 Browser workflow 실행 대상을 먼저 줄입니다.

---

## 선택 권장 코드 정리

Cloudflare 설정과 별개로 다음은 추후 코드에서 명시적으로 정리할 수 있습니다.

- `wrangler.jsonc`에 `"preview_urls": false` 명시
  - 현재 설치된 Wrangler 4.125.0의 기본값은 `false`이므로 즉시 노출 문제는 없음
  - 향후 기본값 변경을 막기 위한 방어적 설정
- 루트 `.env.example`의 `https://jobs.example.com`을 실제 `workers.dev` 예시로 변경

---

## 완료 조건

다음 조건이 모두 만족되면 Cloudflare 배포 설정 완료입니다.

- [ ] D1 실제 ID가 코드와 Cloudflare에서 일치
- [ ] 원격 migration 전체 적용
- [ ] Worker Secret 2개 등록
- [ ] 전체 Worker 사용자 Access 적용
- [ ] 내부 API Service Auth 적용
- [ ] GitHub Secrets 7개 등록
- [ ] Deploy workflow 성공
- [ ] Fast workflow 성공
- [ ] 필요 시 Browser workflow 성공
- [ ] UI에서 실제 공고 확인
- [ ] D1·Worker Metrics 관측 시작
