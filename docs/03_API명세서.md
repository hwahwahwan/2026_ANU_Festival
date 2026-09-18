# API명세서

> v1.1 · 2026-09-18

이 문서는 Frontend와 Backend 사이의 실제 통신 계약이다. Frontend 개발자는 Backend 내부 문서를 읽지 않고 이 문서만으로 API를 호출할 수 있어야 한다.

각 기능의 동작 의미는 `02_기능명세서.md`, DB 컬럼 구조는 `04_DB스키마.md`를 따른다. 이 문서는 통신 규격(무엇을 주고받는가)만 다룬다.

`TBD`로 표시된 항목은 기존 문서에 확정되어 있지 않아 임의로 채우지 않은 값이다. Frontend/Backend가 구현 전에 확정해야 한다.

---

# 1. 공통 규칙

## 1-1. 기본 통신

```text
Next.js Frontend → REST API / Socket.IO → NestJS Backend → PostgreSQL
```

프론트엔드는 PostgreSQL에 직접 접근하지 않는다. 모든 조회/변경은 Backend API를 통한다.

## 1-2. ID

내부 데이터 ID는 UUID 문자열이다.

주문번호(`orderNumber`)는 내부 ID와 별개의 고객 표시용 값이며 형식은 `MMDD-XXXX`(예: `0918-0042`)이다. KST(Asia/Seoul) 기준 날짜별로 `0001`부터 발급한다.

## 1-3. 금액

원화 정수로만 표현한다(`3500`, 소수점 없음).

## 1-4. 날짜/시간

API는 시간대 정보가 포함된 ISO 8601 문자열을 사용한다(예: `2026-09-18T13:30:00.000Z`).

서비스 날짜 판단 기준은 항상 `Asia/Seoul`이다. 기간 조회는 `[from, to)` 형태(from 이상, to 미만)를 사용한다.

## 1-5. OrderStatus

```ts
type OrderStatus =
  | 'PAYMENT_PENDING'
  | 'ACCEPTED'
  | 'COOKING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';
```

Frontend와 Backend는 이 값을 그대로 사용한다. 화면 문구(예: "입금 확인 대기")로의 변환은 Frontend 책임이다.

환불 관련 상태(`REFUNDED` 등)는 정책 확정 전까지 추가하지 않는다.

## 1-6. Content-Type / Validation

요청·응답 모두 `application/json`을 사용한다(REST + NestJS 구조상 사실상 기본값이며, 별도 협의 문서에 명시적으로 적힌 내용은 아니다).

서버는 `class-validator` 기반 `ValidationPipe`를 전역 적용하며 `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`를 사용한다. 서버가 정의하지 않은 필드를 보내면 조용히 무시하지 않고 요청을 거절한다.

## 1-7. 성공 응답

불필요한 공통 `{ data: ... }` wrapper를 사용하지 않는다. Controller는 실제 응답 객체(또는 배열)를 그대로 반환한다.

```json
{ "id": "...", "name": "크로플", "price": 3500, "isAvailable": true }
```

body가 필요 없는 응답(로그인/로그아웃 등)은 `204 No Content`를 사용한다.

**각 API의 성공 HTTP Status Code는 확정되었다.** 새 리소스를 생성하는 API(`POST /orders`, `POST /admin/orders/:orderId/refunds`)는 `201 Created`, body 없는 응답(로그인/로그아웃)은 `204 No Content`, 그 외 조회·갱신 API는 `200 OK`를 사용한다. 각 API 표의 "성공 코드" 칸에 명시했다.

## 1-8. 오류 응답

모든 오류는 다음 구조로 통일한다.

```json
{ "code": "ORDER_NOT_FOUND", "message": "주문을 찾을 수 없습니다." }
```

Frontend는 `message` 문자열이 아니라 `code`를 기준으로 분기한다.

### 공통 Error Code

| Code | HTTP | 의미 |
| --- | --- | --- |
| VALIDATION_ERROR | 400 | 입력값 검증 실패 |
| ADMIN_UNAUTHORIZED | 401 | 관리자 인증 실패/만료 |
| UNAUTHORIZED | 401 | 그 외 인증 필요(범용 fallback) |
| SALES_PASSWORD_INVALID | 403 | 매출 조회 비밀번호 불일치 |
| FORBIDDEN | 403 | 권한 없음(범용 fallback) |
| ORDER_NOT_FOUND | 404 | 주문 조회 실패(lookup 불일치 포함) |
| NOT_FOUND | 404 | 그 외 리소스 없음(범용 fallback) |
| MENU_UNAVAILABLE | 409 | 주문 시점 메뉴 품절/존재하지 않음 |
| IDEMPOTENCY_CONFLICT | 409 | 같은 orderRequestId로 다른 내용 재요청 |
| ORDER_STATE_CONFLICT | 409 | 현재 주문 상태에서 허용되지 않는 처리 |
| CONFLICT | 409 | 그 외 충돌(범용 fallback) |
| ADMIN_LOGIN_FAILED | 401 | 관리자 로그인 시도 자체의 ID/PW 불일치 (신규 확정) |
| DAILY_ORDER_LIMIT_EXCEEDED | 409 | 당일 주문번호 9999건 초과 (신규 확정) |
| INTERNAL_ERROR | 500 | 서버 내부 오류 |

> `GUEST_REQUIRED`는 v0.9 Guest 제거 이후 폐기된 코드다. 사용하지 않는다.

### 로그인 실패 코드 (확정)

`ADMIN_LOGIN_FAILED`(401)를 신규로 사용한다. `ADMIN_UNAUTHORIZED`는 "이미 보호된 라우트에서 인증(Cookie/JWT) 자체가 없거나 만료됨"을 의미하는 별개의 코드이므로 로그인 실패에 재사용하지 않는다.

아이디가 존재하지 않는 경우와 비밀번호가 틀린 경우를 구분하지 않고 항상 `ADMIN_LOGIN_FAILED` 하나로 응답한다(계정 존재 여부가 노출되는 것을 방지).

## 1-9. 인증 방식

고객은 Cookie/Session을 사용하지 않는다. 고객 API는 이름+전화번호(주문 생성) 또는 이름+주문번호(조회)를 요청 본문에 직접 담아 검증받는다.

관리자만 Cookie 기반 인증을 사용한다.

| 항목 | 값 |
| --- | --- |
| Cookie 이름 | `admin_access_token` |
| 저장 방식 | JWT, HttpOnly Cookie |
| 유효기간 | 30분 |
| Refresh Token | 사용하지 않음 |
| JWT Payload | `{ sub: admins.id }` |

만료 시 REST 요청과 기존 Socket 접근 모두 차단한다.

## 1-10. Pagination (확정)

`GET /admin/orders`는 모바일 환경을 고려해 **커서 기반 페이지네이션**을 사용한다.

| Query Parameter | 설명 |
| --- | --- |
| `cursor` | 이전 응답의 `nextCursor` 값. 첫 페이지는 생략 |
| `limit` | 페이지당 개수. 기본값 20, 최대 50 |

정렬은 **최신 생성순 고정**(`created_at DESC`, 동시각 대비 `id DESC` tie-break)이다. 별도의 정렬 옵션은 제공하지 않는다.

필터는 MVP에서 제공하지 않는다(상태별 필터 등은 추후 추가 가능하나 확정 범위 밖).

Response 형태:

```json
{
  "items": [ /* AdminOrderView[] */ ],
  "nextCursor": "opaque-string-or-null"
}
```

`cursor`는 서버가 발급하는 불투명(opaque) 문자열이다. 클라이언트는 값을 해석하지 않고 다음 요청에 그대로 전달한다(내부적으로는 마지막 항목의 `createdAt` + `id`를 인코딩하는 것을 권장).

## 1-11. AdminOrderView (확정)

고객이 받는 `OrderView`에는 `customerPhone`이 없다(주문 조회 화면에서 고객 본인 전화번호를 굳이 다시 보여줄 필요가 없다). 반면 관리자는 미수령 고객에게 직접 연락해야 하므로, **관리자 전용 응답에는 `customerPhone`을 포함한다.**

```ts
type AdminOrderView = OrderView & {
  customerPhone: string;
};
```

`AdminOrderView`를 사용하는 API: `GET /admin/orders`, `POST /admin/orders/:orderId/payment-confirmation`, `PATCH /admin/orders/:orderId/status`, `POST /admin/orders/:orderId/cancel`, `POST /admin/orders/:orderId/refunds`의 응답.

`OrderView`(전화번호 없음)를 사용하는 API: `POST /orders`, `POST /orders/lookup`.

---

# 2. REST API

## 2-1. 고객 API

### POST /orders

| 항목 | 내용 |
| --- | --- |
| 기능 | 신규 주문 생성 |
| 담당 | Backend 1 |
| Method / URL | `POST` `/orders` |
| 인증 | 없음 |
| Path Parameter | 없음 |
| Query Parameter | 없음 |
| 성공 코드 | `201 Created` |

Request Body:

```json
{
  "orderRequestId": "550e8400-e29b-41d4-a716-446655440000",
  "customerName": "홍길동",
  "customerPhone": "010-1234-5678",
  "items": [
    { "menuId": "550e8400-e29b-41d4-a716-446655440001", "quantity": 2 }
  ]
}
```

Response Body (`OrderView`):

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "orderNumber": "0918-0042",
  "customerName": "홍길동",
  "status": "PAYMENT_PENDING",
  "items": [
    {
      "menuId": "550e8400-e29b-41d4-a716-446655440001",
      "menuName": "크로플",
      "unitPrice": 3500,
      "quantity": 2
    }
  ],
  "totalPrice": 7000,
  "createdAt": "2026-09-18T04:00:00.000Z",
  "paymentConfirmedAt": null
}
```

발생 가능한 Error Code: `VALIDATION_ERROR`, `MENU_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`

주요 동작 규칙:

- `menuId`별 가격은 서버가 DB에서 다시 조회해 계산한다. 클라이언트가 보낸 가격/총액 필드는 없으며 있어도 무시하지 않고 `whitelist` 검증에 의해 거절된다.
- 같은 `orderRequestId` + 같은 내용 재요청은 새 주문을 만들지 않고 기존 주문(위와 동일한 Response)을 반환한다.
- Response는 `OrderView`이며 `customerPhone`을 포함하지 않는다(고객 본인 조회 응답에는 불필요, §1-11 참고).

---

### POST /orders/lookup

| 항목 | 내용 |
| --- | --- |
| 기능 | 이름+주문번호로 기존 주문 1건 조회 |
| 담당 | Backend 1 |
| Method / URL | `POST` `/orders/lookup` |
| 인증 | 없음 (이름+주문번호 조합 자체가 조회 근거) |
| 성공 코드 | `200 OK` |

Request Body:

```json
{ "customerName": "홍길동", "orderNumber": "0918-0042" }
```

Response Body: `POST /orders`와 동일한 `OrderView` 구조.

발생 가능한 Error Code: `VALIDATION_ERROR`, `ORDER_NOT_FOUND`

주요 동작 규칙:

- 이름과 주문번호가 모두 일치하는 주문 1건만 반환한다.
- **(확정)** 이름이 틀렸는지 주문번호가 틀렸는지 구분하지 않는다. 둘 중 하나라도 불일치하면 항상 `ORDER_NOT_FOUND` + "입력하신 정보와 일치하는 주문이 없습니다." 같은 동일한 메시지로 응답한다. 백엔드 내부적으로 원인을 알고 있어도 되지만, 응답으로는 구분해서 노출하지 않는다.
- `GET /orders/me`, `GET /orders/:orderId` 같은 세션 기반 API는 존재하지 않는다.

---

### GET /menus

| 항목 | 내용 |
| --- | --- |
| 기능 | 판매 메뉴 목록 조회 |
| 담당 | Backend 2 |
| Method / URL | `GET` `/menus` |
| 인증 | 없음 |
| 성공 코드 | `200 OK` |

Response Body (`MenuView[]`):

```json
[
  { "id": "550e8400-...", "name": "크로플", "price": 3500, "isAvailable": true }
]
```

---

### GET /settings/payment

| 항목 | 내용 |
| --- | --- |
| 기능 | 현재 입금 계좌 조회 |
| 담당 | Backend 2 |
| Method / URL | `GET` `/settings/payment` |
| 인증 | 없음 |
| 성공 코드 | `200 OK` |

Response Body (`PaymentSettingsView`):

```json
{ "bankName": "신한은행", "accountNumber": "110123456789", "accountHolder": "홍길동" }
```

`accountNumber`는 문자열이다(앞자리 0 보존 목적).

---

## 2-2. 관리자 주문 API (Backend 1)

공통: 아래 모든 API는 관리자 Cookie(`admin_access_token`) 인증이 필요하다. 실패 시 `ADMIN_UNAUTHORIZED`(401).

### GET /admin/orders

| 항목 | 내용 |
| --- | --- |
| 기능 | 관리자 주문 목록 조회 |
| 담당 | Backend 1 |
| Method / URL | `GET` `/admin/orders` |
| 인증 | 관리자 |
| Query Parameter | `cursor`(optional), `limit`(optional, 기본 20 최대 50) — §1-10 참고. 필터 없음, 정렬은 최신순 고정 |
| 성공 코드 | `200 OK` |

Response Body: `{ items: AdminOrderView[], nextCursor: string \| null }` (§1-11 참고, `customerPhone` 포함)

---

### POST /admin/orders/:orderId/payment-confirmation

| 항목 | 내용 |
| --- | --- |
| 기능 | 입금 확인 → `ACCEPTED` 전환 |
| 담당 | Backend 1 |
| Method / URL | `POST` `/admin/orders/:orderId/payment-confirmation` |
| 인증 | 관리자 |
| Path Parameter | `orderId` (uuid) |
| Request Body | 없음 |
| 성공 코드 | `200 OK` (갱신된 `AdminOrderView` 반환) |

허용 전이: `PAYMENT_PENDING → ACCEPTED`. 같은 트랜잭션에서 `payment_confirmed_at`을 서버 시각으로 기록한다.

발생 가능한 Error Code: `ORDER_NOT_FOUND`, `ORDER_STATE_CONFLICT`, `ADMIN_UNAUTHORIZED`

---

### PATCH /admin/orders/:orderId/status

| 항목 | 내용 |
| --- | --- |
| 기능 | 조리/준비/수령 상태 전환 |
| 담당 | Backend 1 |
| Method / URL | `PATCH` `/admin/orders/:orderId/status` |
| 인증 | 관리자 |
| Path Parameter | `orderId` (uuid) |
| 성공 코드 | `200 OK` (갱신된 `AdminOrderView` 반환) |

Request Body:

```json
{ "status": "COOKING" }
```

허용 값: `COOKING`, `READY`, `COMPLETED`. 허용 전이 외(`ACCEPTED → READY` 등)는 거절한다.

발생 가능한 Error Code: `VALIDATION_ERROR`, `ORDER_NOT_FOUND`, `ORDER_STATE_CONFLICT`, `ADMIN_UNAUTHORIZED`

---

### POST /admin/orders/:orderId/cancel

| 항목 | 내용 |
| --- | --- |
| 기능 | 미입금 주문 취소 |
| 담당 | Backend 1 |
| Method / URL | `POST` `/admin/orders/:orderId/cancel` |
| 인증 | 관리자 |
| Path Parameter | `orderId` (uuid) |
| Request Body | 없음 |
| 성공 코드 | `200 OK` (갱신된 `AdminOrderView` 반환) |

허용 전이: `PAYMENT_PENDING → CANCELLED`.

발생 가능한 Error Code: `ORDER_NOT_FOUND`, `ORDER_STATE_CONFLICT`, `ADMIN_UNAUTHORIZED`

---

### POST /admin/orders/:orderId/refunds

| 항목 | 내용 |
| --- | --- |
| 기능 | 환불 처리 |
| 담당 | Backend 1 |
| Method / URL | `POST` `/admin/orders/:orderId/refunds` |
| 인증 | 관리자 |
| Path Parameter | `orderId` (uuid) |
| 성공 코드 | `201 Created` (신규 환불 기록 생성, `AdminOrderView` 반환) |

**환불 정책 (확정):** 전액 환불만 지원한다(부분 환불 없음). 입금 확인된 주문(`ACCEPTED`/`COOKING`/`READY`/`COMPLETED`)이면 상태와 무관하게, 몇 번째 상태든 상관없이 직원 판단으로 처리할 수 있다. 주문당 최대 1건만 환불 가능하다. 환불해도 `OrderStatus`는 바뀌지 않고 조리/수령 흐름도 그대로 진행된다 — 환불은 독립적인 기록일 뿐이다.

Request Body:

```json
{
  "refundRequestId": "550e8400-e29b-41d4-a716-446655440099",
  "reason": "고객 미수령으로 환불 처리"
}
```

- `refundRequestId`: 재요청 시 같은 결과를 반환하기 위한 멱등성 키(UUID). 같은 값으로 재요청하면 새 환불을 만들지 않고 기존 결과를 반환한다.
- `amount`는 받지 않는다. 전액 환불만 지원하므로 서버가 `orders.total_price`를 그대로 환불 금액으로 기록한다.
- `reason`: 선택 항목.

Response Body: `AdminOrderView` (환불 자체는 `OrderStatus`를 바꾸지 않으므로 응답의 `status`는 처리 전과 동일하다. 환불 여부·금액·사유·처리자는 `GET /admin/orders/:orderId/history`로 확인한다.)

허용 상태: `ACCEPTED`, `COOKING`, `READY`, `COMPLETED`. 원 주문 데이터(`orders`, `order_items`, `payment_confirmed_at`, `total_price`)는 변경하거나 0으로 만들지 않는다.

발생 가능한 Error Code: `ORDER_NOT_FOUND`, `ORDER_STATE_CONFLICT`(환불 불가 상태이거나 이미 환불된 주문), `ADMIN_UNAUTHORIZED`

---

### GET /admin/orders/:orderId/history

| 항목 | 내용 |
| --- | --- |
| 기능 | 주문 처리 이력 조회 |
| 담당 | Backend 1 |
| Method / URL | `GET` `/admin/orders/:orderId/history` |
| 인증 | 관리자 |
| Path Parameter | `orderId` (uuid) |
| 성공 코드 | `200 OK` |

Response Body (확정, `order_history` 테이블의 camelCase 변환):

```json
[
  {
    "id": "uuid",
    "action": "PAYMENT_CONFIRMED",
    "fromStatus": "PAYMENT_PENDING",
    "toStatus": "ACCEPTED",
    "actorType": "ADMIN",
    "actorId": "uuid (admins.id)",
    "occurredAt": "2026-09-18T04:10:00.000Z",
    "reason": null,
    "metadata": null
  }
]
```

`actorType`은 `CUSTOMER`(주문 생성 시점, 인증되지 않은 고객 본인) 또는 `ADMIN`(그 외 모든 처리)이다. 현재 시스템에 자동 상태 전이가 없으므로 `SYSTEM` 값은 사용하지 않는다. 생성부터 환불까지 시간순(`occurredAt` 오름차순)으로 반환한다.

---

## 2-3. 관리자 운영 API (Backend 2)

### POST /admin/auth/login

| 항목 | 내용 |
| --- | --- |
| 기능 | 관리자 로그인 |
| 담당 | Backend 2 |
| Method / URL | `POST` `/admin/auth/login` |
| 인증 | 없음 |
| 성공 코드 | `204 No Content` (Set-Cookie로 JWT 전달, body 없음) |

Request Body:

```json
{ "username": "admin1", "password": "..." }
```

Response Body: 없음 (§1-7 원칙과 동일하게 body가 필요 없는 요청으로 처리한다. 로그인한 관리자 정보가 화면에 필요하면 별도 조회로 가져온다.)

발생 가능한 Error Code: `VALIDATION_ERROR`, `ADMIN_LOGIN_FAILED`(§1-8 참고)

---

### POST /admin/auth/logout

| 항목 | 내용 |
| --- | --- |
| 기능 | 로그아웃 |
| 담당 | Backend 2 |
| Method / URL | `POST` `/admin/auth/logout` |
| 인증 | 관리자 |
| Request Body | 없음 |
| 성공 코드 | `204 No Content` |

관리자 Cookie를 발급 시와 동일한 옵션으로 삭제한다.

---

### GET /admin/menus

| 항목 | 내용 |
| --- | --- |
| 기능 | 관리용 메뉴 목록 조회 |
| 담당 | Backend 2 |
| Method / URL | `GET` `/admin/menus` |
| 인증 | 관리자 |
| 성공 코드 | `200 OK` |

Response Body: `MenuView[]` (`GET /menus`와 동일 구조)

---

### PATCH /admin/menus/:menuId

| 항목 | 내용 |
| --- | --- |
| 기능 | 메뉴 가격/품절 여부 수정 |
| 담당 | Backend 2 |
| Method / URL | `PATCH` `/admin/menus/:menuId` |
| 인증 | 관리자 |
| Path Parameter | `menuId` (uuid) |
| 성공 코드 | `200 OK` (갱신된 `MenuView` 반환) |

Request Body (둘 중 하나 이상):

```json
{ "price": 4000, "isAvailable": false }
```

`name`(메뉴명)은 수정 대상이 아니다. 메뉴 추가/삭제 API는 없다.

발생 가능한 Error Code: `VALIDATION_ERROR`, `NOT_FOUND`, `ADMIN_UNAUTHORIZED`

---

### GET /admin/settings/payment

| 항목 | 내용 |
| --- | --- |
| 기능 | 현재 계좌 설정 조회(관리자용) |
| 담당 | Backend 2 |
| Method / URL | `GET` `/admin/settings/payment` |
| 인증 | 관리자 |
| 성공 코드 | `200 OK` |

Response Body: `PaymentSettingsView` (`GET /settings/payment`와 동일 구조)

---

### PATCH /admin/settings/payment

| 항목 | 내용 |
| --- | --- |
| 기능 | 계좌 설정 변경 |
| 담당 | Backend 2 |
| Method / URL | `PATCH` `/admin/settings/payment` |
| 인증 | 관리자 (매출 비밀번호 불필요) |
| 성공 코드 | `200 OK` (갱신된 `PaymentSettingsView` 반환) |

Request Body:

```json
{ "bankName": "신한은행", "accountNumber": "110123456789", "accountHolder": "홍길동" }
```

발생 가능한 Error Code: `VALIDATION_ERROR`, `ADMIN_UNAUTHORIZED`

---

### POST /admin/sales/query

| 항목 | 내용 |
| --- | --- |
| 기능 | 매출 통계 조회 (비밀번호 재검증 포함) |
| 담당 | Backend 2 |
| Method / URL | `POST` `/admin/sales/query` |
| 인증 | 관리자 JWT + 본인 비밀번호 |
| 성공 코드 | `200 OK` |

Request Body:

```json
{ "password": "..." }
```

Response Body (`SalesView`):

```json
{
  "timezone": "Asia/Seoul",
  "basis": "payment_confirmed_at",
  "asOf": "2026-09-18T05:00:00.000Z",
  "festivalPeriod": { "from": "2026-09-18T00:00:00+09:00", "to": "2026-09-21T00:00:00+09:00" },
  "today": { "date": "2026-09-18", "quantity": 12, "amount": 42000, "refundedAmount": 0 },
  "festival": { "quantity": 12, "amount": 42000, "refundedAmount": 0 },
  "daily": [ { "date": "2026-09-18", "quantity": 12, "amount": 42000, "refundedAmount": 0 } ],
  "byMenu": {
    "today": [ { "menuId": "uuid", "menuName": "크로플", "quantity": 12, "amount": 42000 } ],
    "festival": [ { "menuId": "uuid", "menuName": "크로플", "quantity": 12, "amount": 42000 } ]
  }
}
```

`festivalPeriod`는 축제 3일 운영 기준 예시다(실제 시작일은 `FESTIVAL_START_AT` 환경변수로 배포 시 설정).

**환불 반영 (확정):** `today`/`festival`/`daily`의 각 합계에 `refundedAmount`를 추가한다. 이는 해당 날짜에 **환불이 처리된**(`order_refunds.processed_at` 기준) 금액의 합이며, 원래 결제된 날짜가 아니라 환불을 처리한 날짜에 집계한다. `amount`(원 결제액)는 환불 여부와 무관하게 그대로 유지하고 수정하지 않는다. 순매출이 필요하면 프론트엔드가 `amount - refundedAmount`로 계산한다. `byMenu`는 메뉴별 환불 배분을 지원하지 않으므로(전액 환불만 지원) `refundedAmount`를 넣지 않는다.

발생 가능한 Error Code: `VALIDATION_ERROR`, `SALES_PASSWORD_INVALID`, `ADMIN_UNAUTHORIZED`

---

# 3. 실시간 이벤트 명세

Socket.IO를 사용한다. 경로는 환경변수 `SOCKET_PATH`(기본 `/socket.io`)를 따른다.

**중요 원칙**

```text
Backend 데이터 변경
  → PostgreSQL COMMIT
  → Event 발생
  → Socket.IO 전달
  → Frontend가 필요하면 REST API로 최신 데이터 재조회
```

Socket.IO는 Source of Truth가 아니다. PostgreSQL이 최종 상태 기준이며, Socket 이벤트가 누락돼도 REST 재조회로 복구한다.

## 3-1. order.created

| 항목 | 내용 |
| --- | --- |
| Event | `order.created` |
| 발생 주체 | Backend 1 |
| 전달 담당 | Backend 2 Realtime |
| 발생 시점 | DB COMMIT 이후 (같은 `orderRequestId` 재시도로 기존 주문을 반환하는 경우 재발생 안 함) |
| 수신 대상 | 관리자(admin room) |
| Payload | `{ orderId: string }` |

수신 측(관리자 화면)은 이벤트를 받으면 주문 목록을 REST로 다시 조회한다.

## 3-2. order.updated

| 항목 | 내용 |
| --- | --- |
| Event | `order.updated` |
| 발생 주체 | Backend 1 |
| 전달 담당 | Backend 2 Realtime |
| 발생 시점 | DB COMMIT 이후 (입금확인/조리/준비/수령/취소/환불 등 실제 변경 시) |
| 수신 대상 | 해당 주문 고객(`order:{orderId}` room) + 관리자(admin room) |
| Payload | `{ orderId: string, status: OrderStatus }` |

환불처럼 `OrderStatus` 문자열 자체는 안 바뀌어도 고객이 최신 정보를 다시 봐야 하는 경우에도 발생시킨다.

## 3-3. Room 구조

| Room | 참여 대상 | 참여 조건 |
| --- | --- | --- |
| `admin room` | 관리자 | Socket handshake에서 관리자 Cookie(JWT) 검증 성공 |
| `order:{orderId}` | 해당 주문 고객 | `customerName` + `orderNumber`를 제시해 `OrderAccessReader.findOrderForLookup()`으로 `orderId`를 확인받은 경우만 |

Room 이름은 서버가 결정한다. 클라이언트가 보낸 room 이름이나 `orderId`만으로는 참여를 허용하지 않는다.

## 3-4. 고객 Socket 인증 (확정됨)

```text
Socket 연결
  → customerName + orderNumber 제시
  → Backend 1 OrderAccessReader.findOrderForLookup()
  → orderId 확인
  → order:{orderId} room 참여
```

REST `POST /orders/lookup`과 동일한 신뢰 수준이다. 별도의 access proof/token은 발급하지 않는다 (`docs/backend/001_백엔드_공통.md` §38~39에서 이미 확정됨).

**전달 프로토콜 (확정):** Socket.IO 클라이언트의 `auth` 옵션으로 연결 시점에 함께 제시한다.

```ts
const socket = io(SOCKET_URL, {
  path: SOCKET_PATH,
  auth: (cb) => cb({ customerName, orderNumber }),
});
```

서버는 `io.use((socket, next) => { ... })` 형태의 handshake 미들웨어에서 `socket.handshake.auth`를 읽어 `OrderAccessReader.findOrderForLookup()`으로 검증하고, 실패하면 연결 자체를 거절한다(`next(new Error(...))`). 연결 후 별도의 "구독 요청" emit 이벤트는 두지 않는다 — 고객은 한 번에 자신의 주문 상세 화면 하나만 보고 있으므로 "연결 = 그 주문을 보고 있다"로 단순화한다. `auth`를 콜백 함수 형태로 넘기면 재연결 시에도 Socket.IO 클라이언트가 자동으로 같은 값을 다시 보내므로 재연결 전용 로직을 별도로 만들 필요가 없다.

## 3-5. 관리자 Socket 인증

Socket handshake에서 관리자 Cookie의 JWT를 검증한다. JWT 만료 시 기존 연결도 관리자 이벤트를 더 이상 받지 못하게 한다.

## 3-6. 재연결

재연결 시 재인증 → room 재검증 → REST 최신 조회 순으로 복구한다. 이벤트 누락이나 순서 역전은 REST 재조회로 해결하며 Socket 자체적으로 순서를 보장하지 않는다.

---

# 4. 확정 현황

이전 버전에서 API 레벨 미확정 사항으로 나열했던 항목(성공 HTTP Status Code, 로그인 실패 Error Code, `GET /admin/orders` 정렬/페이지네이션, 환불 Request/Response, History Response 필드명, 관리자 응답의 `customerPhone` 포함 여부, lookup 실패 응답 통합, Socket 인증 프로토콜, 로그인 Response Body, Pagination 규칙)은 2026-09-18 협의로 모두 확정되어 위 §1~3에 반영했다.

API 레벨에서 남은 TBD는 없다. 다만 이 API가 의존하는 DB 컬럼 중 일부(예: `admins.username` 정확한 컬럼명, `order_items.order_id` 컬럼명, `request_fingerprint` 도입 여부, `payment_settings`의 싱글턴 구조)는 여전히 `04_DB스키마.md`에 TBD로 남아있다 — 이는 API 계약 자체에는 영향을 주지 않는 내부 구현 세부사항이다.
