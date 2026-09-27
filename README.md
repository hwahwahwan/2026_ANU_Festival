# 2026 ANU Festival

안양대학교 축제 부스 운영을 위한 **QR 주문 웹 서비스**입니다.

고객은 부스의 QR 코드를 통해 메뉴를 주문하고 주문 진행 상태를 확인할 수 있으며,  
운영자는 관리자 페이지에서 주문 처리와 메뉴, 계좌, 매출 정보를 관리할 수 있습니다.

## 프로젝트 소개

축제 부스에서 주문을 직접 받고 관리하면서 발생할 수 있는 대기와 주문 누락을 줄이기 위해 개발한 서비스입니다.

고객은 별도의 회원가입이나 로그인 없이 QR을 통해 바로 주문할 수 있습니다.  
주문 후에는 발급된 주문번호로 주문 상태를 확인할 수 있고, 운영자는 관리자 페이지에서 입금 확인부터 조리 및 수령 완료까지 주문 상태를 관리할 수 있습니다.

## 주요 기능

### 고객

- QR을 통한 주문 페이지 접속
- 메뉴 및 가격 확인
- 메뉴 선택 및 주문
- 계좌이체 정보 확인
- 이름 + 주문번호를 통한 주문 조회
- 주문 진행 상태 실시간 확인

### 관리자

- 관리자 로그인
- 주문 목록 확인
- 입금 확인 및 주문 상태 변경
- 주문 취소 및 환불
- 메뉴 가격 및 품절 상태 관리
- 입금 계좌 정보 관리
- 매출 조회

## 서비스 화면

> 현재 프론트엔드 개발 중으로, 완성 후 실제 서비스 화면을 추가할 예정입니다.

<!--
### 고객 주문 화면
![고객 주문 화면](./docs/images/customer-order.png)

### 주문 확인 화면
![주문 확인 화면](./docs/images/order-status.png)

### 관리자 화면
![관리자 화면](./docs/images/admin.png)
-->

## 기술 스택

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- Socket.IO Client

### Backend

- NestJS
- TypeScript
- REST API
- Socket.IO

### Database

- PostgreSQL

### Deployment

- Oracle Cloud
- Docker / Docker Compose
- Nginx

## 팀원 및 역할

| 역할 | 담당 |
| --- | --- |
| Frontend | 고객 및 관리자 페이지 |
| Backend 1 | 주문 · 결제 |
| Backend 2 | 관리자 인증 · 메뉴 · 계좌 · 매출 · 실시간 통신 · 배포 |

## 실행 방법

### Backend

```bash
cd backend
npm install
npm run start:dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

> 실행을 위해 별도의 환경변수와 PostgreSQL 설정이 필요합니다.  
> 자세한 개발 환경 설정은 `docs/` 문서를 참고해주세요.

## 프로젝트 문서

상세한 기능 및 개발 명세는 [`docs`](./docs)에서 확인할 수 있습니다.

- [`기능명세서`](./docs/02_기능명세서.md)
- [`API 명세서`](./docs/03_API명세서.md)
- [`DB 스키마`](./docs/04_DB스키마.md)