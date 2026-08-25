# Security policy

## 보호 경계

운영 배포에서는 반드시 Cloudflare Access로 전체 도메인을 보호하고, `/api/internal/*`에는 별도의 Service Auth 정책을 적용하십시오. `workers.dev` 주소는 비활성화합니다.

## Secret

- `INGEST_BEARER_TOKEN`
- `INGEST_HMAC_SECRET_CURRENT`
- `INGEST_HMAC_SECRET_PREVIOUS`
- GitHub의 Cloudflare Access Service Token

Secret은 저장소에 커밋하지 않습니다. `.dev.vars`와 `.env`는 `.gitignore`에 포함되어 있습니다.

## 크롤러

크롤러는 `http:`/`https:`만 허용하고 loopback, private, link-local, multicast 및 메타데이터 주소를 차단합니다. 리다이렉트 대상도 매회 다시 검사합니다.

## 신고

개인 프로젝트용 템플릿입니다. 공개 저장소로 전환할 경우 저장소의 Security Advisory 또는 비공개 연락 채널을 별도로 설정하십시오.
