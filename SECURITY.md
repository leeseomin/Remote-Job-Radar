# Security policy

## 보호 경계

운영 배포에서는 반드시 Cloudflare Access로 전체 도메인을 보호하고, `/api/internal/*`에는 별도의 Service Auth 정책을 적용하십시오. `workers.dev` 주소는 비활성화합니다.

## Secret

- `INGEST_BEARER_TOKEN`
- `INGEST_HMAC_SECRET_CURRENT`
- `INGEST_HMAC_SECRET_PREVIOUS`
- GitHub의 Cloudflare Access Service Token

Secret은 저장소에 커밋하지 않습니다. `.dev.vars`와 `.env`는 `.gitignore`에 포함되어 있습니다.

공개 저장소의 pull request workflow에는 위 Secret을 전달하지 않습니다. 예약 수집과 배포는 기본 브랜치의 검토된 코드에서만 실행하며, 실패 artifact에는 공개 채용 페이지의 HTML·스크린샷 외의 인증 정보나 쿠키를 저장하지 않습니다.

## 크롤러

크롤러는 `http:`/`https:`만 허용하고 loopback, private, link-local, multicast 및 메타데이터 주소를 차단합니다. 리다이렉트 대상도 매회 다시 검사합니다.

로그인·캡차·차단 우회와 rotating/residential proxy는 사용하지 않습니다. `401`, `403`, `429`, 캡차 또는 로그인 화면은 브라우저나 proxy로 우회하지 않고 실패 또는 격리 상태로 기록합니다.

## 신고

개인 프로젝트용 공개 코드베이스입니다. 저장소의 Security Advisory 또는 별도 비공개 연락 채널로 취약점을 신고하십시오.
