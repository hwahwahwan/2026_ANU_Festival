# Festival Docker 배포 준비

2026-09-20 코드 조사 기준. **구성 준비 단계이며 배포 완료가 아니다.** 이미지 빌드,
컨테이너/DB 생성, migration/seed, production secret 작성은 이번 작업에서 하지 않는다.

## 저장소와 Git 정책

실제 경로는 `/home/ubuntu/projects/2026_ANU_Festival`, 서버 장기 브랜치는 `deploy`다.
작업 전 현재 브랜치를 확인하고 deploy가 아니면 멈춘다. main은 서버에서 READ-ONLY이며
수정/commit/push/merge/PR을 금지한다. 명시적 요청 없이 브랜치 생성·삭제·전환,
pull/fetch/merge/commit/push/PR을 수행하지 않는다.

## 실제 구조와 실행 방식

- `frontend/`: `.gitkeep`만 존재. package.json, lockfile, Next 설정, 환경변수, API/Socket
  클라이언트가 없으므로 Dockerfile과 Compose frontend 서비스는 아직 작성하지 않았다.
- `backend/`: package.json/package-lock.json, Nest CLI/TypeScript 설정, `.env.example`.
  `src/`에는 인증·메뉴·계좌·주문 생성·매출·실시간·DB 모듈이 있고 `test/`에는
  unit/integration/e2e 테스트가 있다. `database/`에는 runner, SQL migration 9개, seed 3개가 있다.
- `docs/`: 공통/API/DB/기능 명세, frontend/backend 개발 문서 및 배포·운영 검증 체크리스트.
- Backend: `npm ci` → `npm run build` (`nest build`) → `npm run start:prod`
  (`node dist/main.js`). Docker CMD는 같은 Node 명령을 직접 실행한다.
- 프로젝트 Node engines/.nvmrc 지정은 없다. lockfile의 빌드 도구가 Node
  `^22.22.3 || ^24.15.0 || >=26.0.0`을 요구해 `node:22.23-bookworm-slim`을 선택했다.
  `npm ci --engine-strict`로 이를 확인한다. ARM64 argon2 fallback 컴파일용 도구는
  최종 runtime에서 제외하며 runtime은 같은 Debian/Node 기반 + production 의존성만 사용한다.
  실제 ARM64 빌드와 네이티브 모듈 로딩은 아직 미검증이다.

## 컨테이너·네트워크·영속성

| 서비스 | 컨테이너 포트 | 호스트 publish | 상태 |
| --- | --- | --- | --- |
| frontend | 3000 | 127.0.0.1:3100 | 코드 구현 후 추가 |
| backend | 4000 | 127.0.0.1:4100 | runtime stage, Node 프로세스 1개 |
| postgres | 5432 | 없음 | postgres:18-bookworm |
| db-tools | 없음 | 없음 | maintenance profile, 수동 일회성 작업 전용 |

Compose project 이름은 `festival`. `festival_application`은 backend와 향후 frontend용
bridge, `festival_database`는 postgres/backend/db-tools 전용 `internal: true` network다.
Frontend를 DB network에 연결하지 않는다. Backend는 `postgres:5432`로 연결한다.
`festival_postgres_data` named volume을 `/var/lib/postgresql`에 마운트한다.
PostgreSQL 18의 실제 PGDATA는 `/var/lib/postgresql/18/docker`다.
개발 문서의 PostgreSQL 18을 따른 것이며 기존 Hermes PostgreSQL과 완전히 별도의
Docker 컨테이너로 운영한다. Festival DB 이름은 `festival`로 예정한다.

DB 초기화·관리 계정과 Backend 런타임 계정을 분리한다. **다음은 배포 시 사용할
예정 계정명이며, 현재 실제 생성된 계정이 아니다.**

| 예정 계정명 | 역할 |
| --- | --- |
| `festival` | DB 초기화, migration/seed, 스키마 및 권한 관리용 관리자 |
| `festival_app` | NestJS Backend의 일반 DB 접근용 비-superuser 계정. 필요한 테이블·시퀀스 권한만 부여 |

실제 계정·비밀번호 생성과 권한 부여는 Festival PostgreSQL 최초 구축의 실제 배포 단계에서
수행한다. 현재는 PostgreSQL 컨테이너, Festival DB, DB 계정 및 비밀번호를 생성하지 않는다.

운영 서비스는 `restart: unless-stopped`, backend는 init 및 30초 종료 유예를 쓴다.
in-process EventEmitter/Socket.IO 때문에 backend replicas=1을 유지하며 scale-out 금지.
local 로그 드라이버에 10m × 3 보관 한도를 설정했다. 백업 정책은 별도 확정해야 한다.
named volume은 백업이 아니며, `down -v` 등 volume 제거 작업을 하지 않는다.

## 환경변수

Git에는 `deploy/env/{postgres,backend,maintenance}/.env.example`만 둔다.
추후 승인된 배포 단계에서 각 같은 디렉터리에 `.env`를 만들고 권한 600을 적용한다.
기존 `.gitignore`가 실제 `.env`를 제외한다. 실제 secret은 이번에 생성하지 않았다.
계정명·역할만 문서에 남기며 실제 비밀번호는 Git에 추적되는 문서나 `.env.example`에
기록하지 않는다. 배포 시 실제 비밀번호는 서버의 production `.env`에만 저장하고
Git에는 포함하지 않는다.
서버의 Compose v5.5.1을 기준으로 정적 검증했다. 구형 docker-compose v1은 대상이 아니다.
Compose `env_file`은 `format: raw`: 따옴표 없이 값을 쓰며 `$` 치환을 하지 않는다.

- postgres: 예정값은 POSTGRES_DB=festival, POSTGRES_USER=festival이며
  POSTGRES_PASSWORD는 관리자 계정용이다. 이는 빈 volume 최초 초기화에만 적용된다.
  비밀번호를 파일에서 바꾸는 것만으로 기존 DB 비밀번호가 바뀌지 않는다.
- backend: DATABASE_URL, JWT secret(최소 32자), public FRONTEND_ORIGIN,
  COOKIE_SECURE=true, COOKIE_SAME_SITE=lax, 선택 COOKIE_DOMAIN,
  SOCKET_PATH=/socket.io, KST 축제 날짜 두 값, DB pool/timeout.
  NODE_ENV=production 및 PORT=4000은 Compose에서도 고정한다.
- maintenance: DB 관리자 `festival`의 DATABASE_URL + 관리자 및 입금 계좌 seed 변수만
  전달한다. seed 비밀번호는 앱 런타임에 전달하지 않는다.
- 운영 Backend의 DATABASE_URL은
  `postgresql://festival_app:<앱 계정 비밀번호를 URL 인코딩한 값>@postgres:5432/festival`,
  migration/seed 등 관리 작업의 DATABASE_URL은
  `postgresql://festival:<관리자 비밀번호를 URL 인코딩한 값>@postgres:5432/festival`로 설정한다.
  꺾쇠 안은 실제 secret이 아닌 자리표시자다. 각 계정의 비밀번호를 사용하고 URI 예약 문자는
  percent-encode한다. 관리 작업의 비밀번호는 POSTGRES_PASSWORD와 일치시킨다.
  localhost, 호스트 5432, 개발 DB URL을 사용하지 않는다.
- 도메인, 축제 날짜, JWT/DB/관리자 secret, 입금 계좌는 비워두었다.
  예시 파일 그대로 운영하지 않는다. Frontend public/build-time 변수 이름은 코드 도입 후 확정한다.

Compose는 서비스별 env_file을 이미 분리하고 있고 DATABASE_URL을 고정하지 않으므로,
이번에는 문서화만으로 충분하다. Docker 구성과 `.env.example`은 수정하지 않는다.
기존 Backend `.env.example`의 `festival` URL 및 maintenance `.env.example`의
"Backend와 같은 URL" 주석은 계정 분리 전 안내다. 실제 배포 시 그대로 적용하지 않고
위 정책에 맞춰 각각 `festival_app`과 `festival`의 production URL을 설정한다.

## Migration / seed: 자동 실행 없음

실제 `backend/database/migrate.ts`가 SQL 파일명을 정렬하여 순서대로 실행하고,
`schema_migrations(filename, applied_at)`에 기록한다. 파일별 transaction이며 적용된 파일은
건너뛴다. 전체 migration의 단일 transaction, checksum 검증, 동시 실행 잠금, 자동 down은 없다.
적용된 SQL은 수정하지 않고 새 파일을 추가한다. 작업은 한 명이 한 번에 하나씩 수행한다.
`docs/04_DB스키마.md`의 runner TBD보다 실제 구현을 기준으로 한다.

앱 빌드는 database/를 제외하고 ts-node는 devDependency이므로 별도 `tools` stage에
runner/SQL/seed/tsconfig와 개발 의존성을 둔다. `db-tools`는 maintenance profile이고
기본 명령은 Node 버전 출력뿐이다. 앱/DB entrypoint나 initdb 디렉터리에 migration을 넣지 않았다.

**아래는 미래 배포 승인 후 절차이며 이번에는 실행하지 않는다.**

1. SQL 변경, 접속 대상, 확정된 계정 분리 정책, 백업·복구 절차를 검토한다. 실제 배포 단계에서
   계정별 비밀번호를 생성하고 역할별 production `.env`에만 저장한다.
2. 승인 후 ARM64 이미지를 빌드·검증한다. 관리자 `festival`로 Festival postgres/DB를
   최초 초기화하고 health를 확인한다. `festival_app` 계정을 생성하며 관리자 권한은 부여하지 않는다.
   DB 컨테이너 첫 실행 자체가 DB를 생성하므로 현재 단계에서는 금지다.
3. Backend/외부 ingress를 열기 전에 관리자 `festival` 접속 정보를 사용하는 db-tools로
   아래 명령을 한 줄씩 실행하여 성공을 확인한다.

```bash
docker compose --profile maintenance run --rm --no-deps db-tools npm run migrate
docker compose --profile maintenance run --rm --no-deps db-tools npm run seed:admin
docker compose --profile maintenance run --rm --no-deps db-tools npm run seed:menus
docker compose --profile maintenance run --rm --no-deps db-tools npm run seed:payment-settings
```

migration/seed 완료 후 관리자는 `festival_app`에 필요한 테이블·시퀀스 권한만 부여하고,
이후 migration으로 추가되는 객체의 권한도 확인한다. Backend의 `festival_app` 접속과
일반 DB 접근이 정상인지 확인한 뒤 서비스를 공개한다.

`--no-deps`는 이미 별도로 준비·확인한 DB만 사용하기 위한 것이다. 실패 시 다음 단계로
넘어가지 않는다. migration 실패 파일은 rollback되지만 앞선 파일의 commit은 남는다.
초기 설치에는 관리자/메뉴/계좌를 준비하고, 기존 운영 DB 업그레이드에는 필요한 migration만
검토한다. seed를 매 재시작마다 실행하지 않는다.
admin은 기존 username의 비밀번호를 보존하고, menus는 이름이 없는 항목만 추가하며,
payment-settings는 기존 singleton 계좌를 보존한다. menus seed에는 병렬 실행 보호가 없으므로
동시 실행하지 않는다. 서비스 공개 전 `/settings/payment`의 200과 실제 계좌를 확인한다.

## Health / ingress

postgres는 TCP `pg_isready` healthcheck를 쓴다. backend와 db-tools는
`depends_on: service_healthy`로 초기 DB 준비를 기다린다. 이는 schema/migration/계좌 준비나
앱 인증 성공까지 보장하지 않는다. 앱 자체는 Pool만 생성하므로 listen 성공도 DB readiness가 아니다.
Backend에는 /health가 없어 HTTP healthcheck를 추가하지 않았다. Frontend도 구현 전이다.
재부팅의 restart policy는 Compose 초기 의존 순서를 다시 보장하지 않으며 DB 장애 후 복구는
별도 검증해야 한다. unhealthy 표시만으로 Docker가 자동 재시작하지도 않는다.

Host Nginx만 외부 80/443 ingress로 사용한다. 현재 Nest에 `/api` global prefix가 없으므로
향후 `location /api/`에서 `proxy_pass http://127.0.0.1:4100/;` 형태로 prefix를 제거한다.
`/socket.io/`는 경로를 유지하고 같은 backend로 전달하며 WebSocket Upgrade를 지원해야 한다.
현재 trust proxy=1/CORS credentials와 동일 Origin 쿠키 정책을 유지한다.
Cloudflare 추가 시 신뢰 IP 및 rate limit 동작을 다시 검증한다. Nginx 설정은 이번에 수정하지 않았다.

## 개발 완료 후 확정 / 실행 전 검증

- Frontend package/lockfile, Node 요구사항, next build/start 또는 standalone 방식,
  0.0.0.0:3000 bind, public 파일/이미지 처리, API 상대 경로 `/api`, Socket.IO
  path/credentials/reconnect, SSR 내부 API URL과 build-time/runtime 변수 사용 위치 확인.
  그 후 frontend Dockerfile/ignore/Compose service를 실제 코드 기준으로 추가한다.
- B1 이름+주문번호 조회, 관리자 주문/입금확인/상태변경/취소/환불/이력 API 및
  Realtime order.updated/고객 room 인증 미완료. 메뉴 사진 저장·서빙·volume도 결정 필요.
- 이미지 digest 고정 및 ARM64 manifest 확인, 승인 후 npm ci/build와 argon2 로딩,
  production 의존성만으로 앱 부팅, tools의 ts-node/migration runner 호환성 검증.
- DB 역할/비밀번호/URL 일치, 실제 날짜/도메인/쿠키, backup/restore 검증 계획 확정.
- 3100/4100 포트 여유, loopback publish, DB ports 없음, 기존 서비스 상태 확인.
- schema/seed 검증 후 별도 승인된 배포에서 API·HTTPS 쿠키·WebSocket 101·재접속·실기기
  주문 전체 흐름·DB 영속성·부하/메모리 검증. 현재 미구현 기능은 출시 차단 항목이다.
- 기존 Nginx 80/443, Gitea 3000, Hermes PostgreSQL 5432, dress_up 8080,
  hindsight 9177 및 Hermes 서비스를 유지한다. ANU-LMS Chromium은 중지 상태를 유지한다.

현재 가능한 읽기 전용 정적 검증 (env 파일을 생성하거나 읽지 않음):

```bash
docker compose --profile maintenance config --no-env-resolution --quiet
git diff --check
```

이 검증은 빌드/실행 성공이나 env 유효성 검증을 대신하지 않는다.

이미지 형식 참고: [공식 Node 이미지](https://github.com/nodejs/docker-node),
[PostgreSQL 18 volume 안내](https://docs.docker.com/guides/postgresql/immediate-setup-and-data-persistence/).
