• Cloudflare에서 직접 해야 하는 것은 주로 1번과 6번, 그리고 인증·Secret 설정입니다. 2~5번은 저장소 코드 작업
  입니다.

   항목                  작업 위치
  ━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   workers.dev 설정      Cloudflare + 코드
  ────────────────────  ─────────────────────────────────────
   실제 D1 ID 설정       Cloudflare에서 생성, 코드에 ID 입력
  ────────────────────  ─────────────────────────────────────
   _headers              코드만
  ────────────────────  ─────────────────────────────────────
   sourcemap 비활성화    코드만
  ────────────────────  ─────────────────────────────────────
   ingest 10건·256KB     코드만
  ────────────────────  ─────────────────────────────────────
   source fingerprint    코드 + D1 원격 마이그레이션
  ────────────────────  ─────────────────────────────────────
   사용량 관측           Cloudflare Dashboard

  ## Cloudflare에서 직접 할 작업

  ### 1. D1 데이터베이스 생성

  Cloudflare Dashboard 또는 CLI에서 생성합니다.

  pnpm --filter @remote-job-radar/worker exec \
    wrangler d1 create remote-job-radar-prod

  반환된 database_id를 apps/worker/wrangler.jsonc:18에 입력합니다.

  database_id는 Secret이 아니므로 저장소에 커밋해도 됩니다.

  ### 2. workers.dev 주소 활성화

  Cloudflare의 Workers & Pages에서 계정의 workers.dev 서브도메인을 확인합니다.

  코드에서는 다음처럼 변경해야 합니다.

  "workers_dev": true

  그리고 jobs.example.com의 routes 설정은 제거합니다.

  배포 주소는 다음 형태입니다.

  https://remote-job-radar.<계정-subdomain>.workers.dev

  ### 3. Cloudflare Access 설정

  Zero Trust → Access → Applications에서 두 개를 구성하는 것이 좋습니다.

  1. 사용자 앱

  remote-job-radar.<계정>.workers.dev/*

  - 본인 이메일만 Allow
  - One-time PIN 또는 원하는 로그인 방식

  2. 크롤러 내부 API

  remote-job-radar.<계정>.workers.dev/api/internal/*

  - Service Auth
  - GitHub Actions용 Service Token 생성

  workers.dev도 Access로 보호할 수 있습니다. Cloudflare Access 문서
  (https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

  ### 4. Worker Secret 설정

  Cloudflare Worker에 다음 Secret을 등록합니다.

  cd apps/worker

  pnpm exec wrangler secret put INGEST_BEARER_TOKEN
  pnpm exec wrangler secret put INGEST_HMAC_SECRET_CURRENT
  pnpm exec wrangler secret put INGEST_HMAC_SECRET_PREVIOUS

  Bearer와 HMAC은 서로 다른 충분히 긴 난수를 사용해야 합니다.

  ### 5. GitHub Actions용 Cloudflare 정보 등록

  Cloudflare에서 다음 정보를 발급하거나 확인한 뒤 GitHub Repository Secrets에 넣습니다.

  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  CF_ACCESS_CLIENT_ID
  CF_ACCESS_CLIENT_SECRET
  APP_BASE_URL
  INGEST_BEARER_TOKEN
  INGEST_HMAC_SECRET

  APP_BASE_URL은 최종 workers.dev 주소입니다.

  ### 6. 마이그레이션 적용

  fingerprint 구현으로 새 마이그레이션이 추가된 뒤 원격 D1에 적용합니다.

  pnpm --filter @remote-job-radar/worker exec \
    wrangler d1 migrations apply remote-job-radar-prod --remote

  현재 deploy workflow에도 원격 마이그레이션 단계가 있으므로, 설정 완료 후에는 GitHub Actions가 처리할 수 있
  습니다.

  ### 7. 배포 후 사용량 확인

  Cloudflare Dashboard에서 확인합니다.

  - Workers & Pages → 해당 Worker → Metrics
      - Requests
      - CPU time
      - Errors

  - D1 → remote-job-radar-prod → Metrics
      - Rows read
      - Rows written
      - Database size

  초기 관측 기준으로는 다음 정도가 안전합니다.

  Worker CPU p95: 10ms에 지속적으로 근접하지 않는지
  D1 rows_written: 100,000/day의 절반 이하인지
  D1 rows_read: 5,000,000/day에 근접하지 않는지

  ## 저장소에서 처리할 작업

  다음은 Cloudflare Dashboard에서 할 일이 없습니다.

  - apps/web/public/_headers 추가
  - sourcemap: false
  - ingest 10건·256KB 전환
  - source fingerprint 구현 및 테스트
