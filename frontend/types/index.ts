// frontend/types/index.ts

// 주문의 6가지 상태[cite: 11]
export type OrderStatus =
  | 'PAYMENT_PENDING'
  | 'ACCEPTED'
  | 'COOKING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';

// 고객이 주문을 생성할 때 서버로 보낼 데이터[cite: 7, 12]
export interface CreateOrderInput {
  orderRequestId: string;
  customerName: string;
  customerPhone: string;
  items: { menuId: string; quantity: number }[];
}

// 고객이 기존 주문을 찾을 때 서버로 보낼 데이터[cite: 7, 12]
export interface OrderLookupInput {
  customerName: string;
  orderNumber: string;
}

// 화면에 보여줄 메뉴 데이터[cite: 11]
export interface MenuView {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

// 부스의 무통장 입금 계좌 정보[cite: 11]
export interface PaymentSettingsView {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

// 주문에 포함된 각각의 메뉴 내역[cite: 11]
export interface OrderItemView {
  menuId: string;
  menuName: string;
  unitPrice: number;
  quantity: number;
}

// 화면에 보여줄 최종 주문 데이터[cite: 11]
export interface OrderView {
  id: string;
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  items: OrderItemView[];
  totalPrice: number;
  createdAt: string;
  paymentConfirmedAt: string | null;
}