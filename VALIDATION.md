# 오프라인 검증 기록

**검증일:** 2026-08-13  
**대상:** Remote Job Radar v0.1.0 소스 패키지

## 1. 통과한 검증

### 저장소·설정 정적 검사

- 필수 구현 파일 32개 존재·비어 있지 않음
- `FIXME`, `IMPLEMENT_ME` 잔존 여부 검사 통과
- 실제 Secret 형태의 문자열 정적 검사 통과
- `package.json` 계열 JSON 9개 파싱 통과
- `wrangler.jsonc` 파싱 및 다음 설정 확인
  - `workers_dev: false`
  - SPA fallback
  - `/api/*` Worker 우선 실행
  - D1 migrations 경로
- GitHub Actions YAML 6개 파싱 통과

### TypeScript·Vue 소스

외부 패키지를 최소 선언으로 대체한 오프라인 TypeScript 검사에서 다음 소스가 오류 없이 통과했습니다.

- Worker 전체
- Crawler 전체
- contracts/domain/shared/db 패키지
- Web의 일반 TypeScript 파일
- Vue SFC의 `<script setup lang="ts">` 8개
- Vue template 태그 균형 검사 8개

### D1/SQLite 스키마

Python 내장 SQLite 메모리 DB에서 실제 migration과 demo seed를 실행했습니다.

- `PRAGMA integrity_check`: `ok`
- seed 결과
  - companies: 3
  - sources: 3
  - jobs: 4
  - job_versions: 4
  - job_actions: 1
- FTS5 검색: `webgl OR webgpu` 2건
- FTS INSERT/UPDATE/DELETE trigger 동작 확인
- Worker의 실제 `UPSERT_JOB_SQL` 추출·실행
  - placeholder: 37개
  - 동일 `(source_id, external_id)` 재수집 시 중복 행 없이 갱신
  - 갱신된 title이 FTS에 반영됨
- 정상 수집에서 1회 누락 시 `open`, 2회 연속 누락 시 `closed` 확인
- run 종료 전에 `source-complete`가 누락된 소스의 lease 해제·quarantine 처리 확인

### 독립 런타임 회귀 검사

네트워크나 외부 라이브러리가 필요 없는 핵심 모듈을 JavaScript로 변환해 실행했습니다.

- Worldwide + async-first + Three.js/WebGL/GLSL 공고: 100점
- `global remote team` 문구가 있어도 `US only` 제한이 우선됨
- 45개 ingest 배치: `20 / 20 / 5`
- 단일 공고가 안전한 512KB 상한을 넘으면 거부
- loopback/private/IPv4-mapped IPv6 SSRF 차단
- 올바른 HMAC 검증 성공, 잘못된 Secret 검증 실패

## 2. 이 생성 환경에서 실행하지 못한 항목

이 환경은 외부 패키지 레지스트리에 접근할 수 없고 Node.js 22.16.0만 제공되었습니다. 프로젝트 요구 버전은 Node.js 24 LTS + pnpm 10입니다. 따라서 다음은 실제 의존성 설치 후 사용자 환경 또는 GitHub Actions에서 최종 확인해야 합니다.

- `pnpm install`
- 실제 `vue-tsc`, Vitest 전체 실행
- Vite production build
- Wrangler dry-run 및 Cloudflare 배포
- Playwright Chromium 설치·실제 동적 채용 페이지 수집
- Cloudflare Access 정책과 Service Token의 실배포 연동
- 실제 D1 원격 migration

이 때문에 생성본에는 가짜 lockfile을 넣지 않았습니다. Node.js 24 환경에서 최초 `pnpm install` 후 생성되는 `pnpm-lock.yaml`을 검토하고 커밋하십시오. CI는 최초 실행을 위해 `--no-frozen-lockfile`을 사용하도록 구성했습니다.

## 3. 배포 전 최소 명령

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install
pnpm check
pnpm db:reset:local
pnpm build
```

그 다음 `docs/DEPLOY_KO.md` 순서대로 D1 ID, Custom Domain, Worker secrets, Cloudflare Access, GitHub secrets를 설정합니다.
