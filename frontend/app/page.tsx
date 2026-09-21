// frontend/app/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import MenuCard from '../components/MenuCard';
import { MenuView, OrderView, PaymentSettingsView } from '../types';

export default function OrderPage() {
    // 데이터 상태 관리
    const [menus, setMenus] = useState<MenuView[]>([]);
    const [quantities, setQuantities] = useState<{ [key: string]: number }>({});
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // 주문 완료 후 표시할 상태
    const [completedOrder, setCompletedOrder] = useState<OrderView | null>(null);
    const [paymentSettings, setPaymentSettings] = useState<PaymentSettingsView | null>(null);
    const [isPaymentLoading, setIsPaymentLoading] = useState(false);

    // 백엔드 API 기본 주소 (환경변수가 없으면 로컬 백엔드 3001번 포트 사용)
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    // 1. 실제 메뉴 데이터 불러오기[cite: 16]
    useEffect(() => {
        const fetchMenus = async () => {
            try {
                const res = await fetch(`${API_URL}/menus`);
                if (res.ok) {
                    const data = await res.json();
                    setMenus(data);
                }
            } catch (error) {
                console.error('메뉴 로딩 실패:', error);
            }
        };
        fetchMenus();
    }, [API_URL]);

    const handleIncrease = (menuId: string) => {
        setQuantities((prev) => ({ ...prev, [menuId]: (prev[menuId] || 0) + 1 }));
    };

    const handleDecrease = (menuId: string) => {
        setQuantities((prev) => {
            const current = prev[menuId] || 0;
            if (current <= 1) {
                const copy = { ...prev };
                delete copy[menuId];
                return copy;
            }
            return { ...prev, [menuId]: current - 1 };
        });
    };

    const totalPrice = Object.entries(quantities).reduce((sum, [id, qty]) => {
        const menu = menus.find((m) => m.id === id);
        return sum + (menu ? menu.price * qty : 0);
    }, 0);

    // 2. 주문 생성 및 완료 처리
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (Object.keys(quantities).length === 0) {
            alert('메뉴를 1개 이상 선택해주세요.');
            return;
        }

        setIsSubmitting(true);

        const orderData = {
            orderRequestId: uuidv4(), // API 명세서 기준 필수 필드[cite: 16]
            customerName,
            customerPhone,
            items: Object.entries(quantities).map(([menuId, quantity]) => ({
                menuId,
                quantity,
            })),
        };

        try {
            const orderRes = await fetch(`${API_URL}/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData),
            });

            if (!orderRes.ok) {
                const errorData = await orderRes.json();
                if (errorData.code === 'MENU_UNAVAILABLE') {
                    alert('선택하신 메뉴 중 품절된 상품이 있습니다. 다시 확인해주세요.');
                } else if (errorData.code === 'IDEMPOTENCY_CONFLICT') {
                    alert('주문 내용이 충돌했습니다. 기존 주문을 확인해주세요.');
                } else {
                    alert('주문 처리 중 오류가 발생했습니다.');
                }
                setIsSubmitting(false);
                return;
            }

            const newOrder: OrderView = await orderRes.json();
            setCompletedOrder(newOrder);

            // 3. localStorage에 주문 정보 저장 (최근 주문 내역)[cite: 17, 18]
            const STORAGE_KEY = 'anu-festival:recent-orders';
            const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            const newEntry = {
                customerName: newOrder.customerName,
                orderNumber: newOrder.orderNumber,
                savedAt: new Date().toISOString(), // ISO 8601 형식으로 저장[cite: 15]
            };

            const filtered = existing.filter(
                (item: { orderNumber: string }) => item.orderNumber !== newOrder.orderNumber
            );
            localStorage.setItem(STORAGE_KEY, JSON.stringify([newEntry, ...filtered]));

            // 4. 계좌 정보 분리 조회 (주문 성공 직후 병렬로 불러와 합침)[cite: 16, 17]
            setIsPaymentLoading(true);
            const paymentRes = await fetch(`${API_URL}/settings/payment`);
            if (paymentRes.ok) {
                const paymentData = await paymentRes.json();
                setPaymentSettings(paymentData);
            } else if (paymentRes.status === 404) {
                setPaymentSettings(null); // 계좌 정보 없음 처리[cite: 16]
            }
            setIsPaymentLoading(false);

        } catch (error) {
            alert('서버와 연결할 수 없습니다.');
            setIsSubmitting(false);
        }
    };

    // 주문 완료 화면 렌더링
    if (completedOrder) {
        return (
            <main className="min-h-screen p-6 max-w-md mx-auto bg-[#F4EBD9]">
                <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-[#6B4423] text-center mt-10">
                    <h1 className="text-3xl font-bold text-[#6B4423] mb-4">주문 완료!</h1>
                    <p className="text-[#333333] mb-2">주문번호</p>
                    <p className="text-4xl font-bold text-[#8B2A2A] mb-6">{completedOrder.orderNumber}</p>

                    <div className="bg-[#F4EBD9] p-4 rounded-lg mb-6">
                        <h3 className="font-bold text-[#333333] mb-2 border-b-2 border-[#6B4423] pb-2">입금 계좌</h3>
                        {isPaymentLoading ? (
                            <p className="text-sm py-2">계좌 정보를 불러오는 중...</p>
                        ) : paymentSettings ? (
                            <div className="py-2">
                                <p className="text-lg font-bold text-[#333333]">
                                    {paymentSettings.bankName} {paymentSettings.accountNumber}
                                </p>
                                <p className="text-sm text-[#333333] mt-1">예금주: {paymentSettings.accountHolder}</p>
                            </div>
                        ) : (
                            <p className="text-sm text-[#8B2A2A] font-bold py-2">
                                입금 계좌 준비 중입니다.<br />부스에 문의해주세요.
                            </p>
                        )}
                    </div>

                    <div className="flex justify-between items-center mb-6 px-2">
                        <span className="font-bold text-[#333333]">결제금액</span>
                        <span className="text-2xl font-bold text-[#8B2A2A]">{completedOrder.totalPrice.toLocaleString()}원</span>
                    </div>

                    <div className="bg-white border-2 border-[#6B4423] p-4 rounded-lg">
                        <p className="text-sm text-[#333333] mb-1">현재 상태</p>
                        <p className="text-xl font-bold text-[#6B4423]">💰 입금 대기</p>
                    </div>
                </div>
            </main>
        );
    }

    // 기본 메뉴 주문 화면 렌더링
    return (
        <main className="min-h-screen p-6 max-w-md mx-auto bg-[#F4EBD9]">
            <div className="text-center mb-6 pt-4">
                <h1 className="text-3xl font-bold text-[#6B4423] mb-1">소프트 왕국</h1>
                <p className="text-sm text-[#333333]">메뉴를 고르고 주문을 접수해주세요</p>
            </div>

            <div className="mb-8">
                {menus.length === 0 ? (
                    <p className="text-center text-[#6B4423] py-10 font-bold">메뉴를 불러오는 중입니다...</p>
                ) : (
                    menus.map((menu) => (
                        <MenuCard
                            key={menu.id}
                            menu={menu}
                            quantity={quantities[menu.id] || 0}
                            onIncrease={() => handleIncrease(menu.id)}
                            onDecrease={() => handleDecrease(menu.id)}
                        />
                    ))
                )}
            </div>

            <form onSubmit={handleSubmit} className="bg-white p-5 rounded-xl shadow-lg border-2 border-[#6B4423] mb-8">
                <h2 className="text-xl font-bold text-[#333333] mb-4 border-b-2 border-[#F4EBD9] pb-2">주문자 정보</h2>

                <div className="mb-4">
                    <label className="block text-sm font-bold text-[#6B4423] mb-1">이름</label>
                    <input
                        type="text"
                        required
                        placeholder="홍길동"
                        className="w-full border-2 border-[#F4EBD9] rounded-lg p-2 text-[#333333] focus:outline-none focus:border-[#6B4423]"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                    />
                </div>

                <div className="mb-6">
                    <label className="block text-sm font-bold text-[#6B4423] mb-1">전화번호 (연락용)</label>
                    <input
                        type="tel"
                        required
                        placeholder="01012345678"
                        className="w-full border-2 border-[#F4EBD9] rounded-lg p-2 text-[#333333] focus:outline-none focus:border-[#6B4423]"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                    />
                </div>

                <div className="flex justify-between items-center mb-6">
                    <span className="font-bold text-[#333333]">예상 총액</span>
                    <span className="text-2xl font-bold text-[#8B2A2A]">{totalPrice.toLocaleString()}원</span>
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting || totalPrice === 0}
                    className="w-full bg-[#6B4423] text-[#F4EBD9] font-bold text-lg py-3 rounded-lg hover:bg-[#8B2A2A] transition-colors disabled:opacity-50"
                >
                    {isSubmitting ? '주문 처리 중...' : '주문하기'}
                </button>
            </form>
        </main>
    );
}