// frontend/components/MenuCard.tsx
import { MenuView } from '../types';

interface MenuCardProps {
  menu: MenuView;
  quantity: number; // 현재 장바구니에 담긴 개수
  onIncrease: () => void; // [+] 버튼을 눌렀을 때 실행될 함수
  onDecrease: () => void; // [-] 버튼을 눌렀을 때 실행될 함수
}

export default function MenuCard({ menu, quantity, onIncrease, onDecrease }: MenuCardProps) {
  return (
    <div className="bg-[#F4EBD9] border-2 border-[#6B4423] rounded-xl p-4 flex justify-between items-center shadow-lg mb-4">
      {/* 텍스트 영역 */}
      <div className="flex-1">
        <h3 className="text-xl font-bold text-[#333333] mb-1">{menu.name}</h3>
        <p className="text-[#6B4423] font-bold">{menu.price.toLocaleString()}원</p>
      </div>

      {/* 수량 조절 버튼 또는 품절 표시 */}
      {menu.isAvailable ? (
        <div className="flex items-center space-x-3 bg-white/50 px-3 py-1 rounded-full border border-[#6B4423]/50">
          <button
            onClick={onDecrease}
            className="text-2xl font-bold text-[#8B2A2A] w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#6B4423]/10 transition-colors"
          >
            -
          </button>
          <span className="text-lg font-bold text-[#333333] w-4 text-center">{quantity}</span>
          <button
            onClick={onIncrease}
            className="text-2xl font-bold text-[#8B2A2A] w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#6B4423]/10 transition-colors"
          >
            +
          </button>
        </div>
      ) : (
        <div className="bg-[#333333] text-[#F4EBD9] font-bold px-4 py-2 rounded-lg border-2 border-[#333333]">
          재료 소진
        </div>
      )}
    </div>
  );
}