/**
 * `POST /admin/sales/query` 응답 계약(03_API명세서.md, 001_백엔드_공통.md §44).
 *
 * `amount`는 항상 원 결제액이며 순매출이 아니다(환불 여부와 무관하게 유지).
 * 순매출이 필요하면 프론트엔드가 `amount - refundedAmount`를 계산한다.
 * `byMenu`는 메뉴별 환불 배분을 지원하지 않으므로(전액 환불만 지원) `refundedAmount`를
 * 포함하지 않는다.
 */
export interface SalesTotals {
  quantity: number;
  amount: number;
}

export interface SalesTotalsWithRefund extends SalesTotals {
  // 환불 처리일(order_refunds.processed_at) 기준 집계. amount(원 결제액)는 그대로 유지한다.
  refundedAmount: number;
}

export interface SalesByMenuItem extends SalesTotals {
  menuId: string;
  menuName: string;
}

export interface SalesView {
  timezone: 'Asia/Seoul';
  basis: 'payment_confirmed_at';
  asOf: string;
  festivalPeriod: {
    from: string;
    to: string;
  };
  today: SalesTotalsWithRefund & { date: string };
  festival: SalesTotalsWithRefund;
  daily: (SalesTotalsWithRefund & { date: string })[];
  byMenu: {
    today: SalesByMenuItem[];
    festival: SalesByMenuItem[];
  };
}
