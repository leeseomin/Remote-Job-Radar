# 로컬 검증 기록

**검증일:** 2026-08-26

**대상:** Remote Job Radar v0.1.0 현재 워크트리

**환경:** Node.js v26.3.0, pnpm 10.15.0, Wrangler 4.125.0

## 통과한 검증

`./build.sh --check-only`로 의존성 잠금, 로컬 D1, 전체 검사와 production build를 한 번에 검증했습니다.

- `pnpm install --frozen-lockfile`: 통과
- 로컬 D1 migration `0003_source_content_fingerprint.sql`: 3개 statement 적용 성공
- demo seed: 6개 statement 적용 성공
- 전체 workspace TypeScript/Vue typecheck: 통과
- Vitest: 18개 파일, 총 55개 테스트 통과
  - contracts: 2
  - db: 3
  - domain: 3
  - Worker: 29
  - crawler: 18
- 정적 source 검사: 필수 파일 37개 확인
- Vue production build: 통과
- Worker `wrangler deploy --dry-run`: 통과

## 이번 변경의 핵심 회귀 검사

- ingest 계약은 요청당 최대 10개 공고만 허용
- crawler와 Worker 모두 body 최대 256KB 적용
- 공고 순서와 무관한 source content fingerprint 계산
- 동일 fingerprint에서는 ingest를 생략하고 `not_modified` 완료 처리
- migration 직후에는 HTTP validator를 억제해 최초 full snapshot을 강제
- fingerprint fast path에서도 마지막 full snapshot을 기준으로 누락을 누적해 2회 연속 누락된 공고만 `closed` 처리
- 일부 batch만 저장된 실패는 snapshot·validator를 무효화해 다음 실행에서 full ingest 강제
- 잘못된 `not_modified`, 미완료 run, 만료 lease도 snapshot을 무효화해 hard-stop 뒤 partial state 재사용 방지
- 일시적 HTTP·네트워크 실패는 `active` 상태와 backoff 유지, 구조적 이상만 quarantine
- 소스 정체성(company/kind/url/adapter/config) 변경 시 validator·fingerprint·snapshot·lease 초기화
- 실행 중 source를 pause하면 snapshot은 보존하고 lease만 즉시 해제
- unchanged ingest의 FTS 재작성 방지와 source 재할당 시 `company_id` 갱신 확인
- CSP·보안 헤더가 로컬 Worker의 정적 SPA 응답에 실제 포함됨
- production 산출물에 `_headers`가 복사되고 `.map` 파일이 생성되지 않음

## 아직 실행하지 않은 원격 작업

이번 단계에서는 Cloudflare와 GitHub의 외부 상태를 변경하지 않았습니다. 다음 항목은 배포 시 수행합니다.

- 실제 D1 생성 후 `database_id` 입력
- 원격 D1 migration 적용
- Worker secret과 GitHub Actions secret 등록
- `workers.dev` 전체 호스트 및 내부 API에 Cloudflare Access 정책 적용
- 실제 Worker 배포와 GitHub Actions 예약 크롤링 실행
- D1 `rows_written`와 Worker CPU를 1~2주 관측

자세한 순서는 `docs/DEPLOY_KO.md`를 따릅니다.
