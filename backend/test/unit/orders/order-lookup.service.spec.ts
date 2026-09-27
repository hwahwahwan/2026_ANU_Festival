import { OrderLookupService } from '../../../src/orders/order-lookup.service';
import { DatabaseService } from '../../../src/database/database.service';
import { OrdersRepository, OrderRow } from '../../../src/orders/orders.repository';
import { OrderItemsRepository, OrderItemRow } from '../../../src/orders/order-items.repository';
import { LookupOrderDto } from '../../../src/orders/dto/lookup-order.dto';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';

const FAKE_DATABASE = {} as unknown as jest.Mocked<DatabaseService>;

const ORDER_ROW: OrderRow = {
  id: 'order-1',
  order_number: '0918-0001',
  order_request_id: '550e8400-e29b-41d4-a716-446655440000',
  customer_name: '홍길동',
  customer_phone: '010-1234-5678',
  status: 'PAYMENT_PENDING',
  total_price: 7000,
  payment_confirmed_at: null,
  created_at: new Date('2026-09-18T00:00:00Z'),
};

const ORDER_ITEM_ROWS: OrderItemRow[] = [
  {
    id: 'item-1',
    order_id: 'order-1',
    menu_id: '11111111-1111-1111-1111-111111111111',
    menu_name: '아망추',
    unit_price: 3500,
    quantity: 2,
  },
];

function createDto(overrides: Partial<LookupOrderDto> = {}): LookupOrderDto {
  return {
    customerName: '홍길동',
    orderNumber: '0918-0001',
    ...overrides,
  } as LookupOrderDto;
}

function createHarness() {
  const ordersRepository = {
    findByCustomerNameAndOrderNumber: jest.fn(),
  } as unknown as jest.Mocked<OrdersRepository>;

  const orderItemsRepository = {
    findByOrderId: jest.fn(),
  } as unknown as jest.Mocked<OrderItemsRepository>;

  const service = new OrderLookupService(
    FAKE_DATABASE,
    ordersRepository,
    orderItemsRepository,
  );

  return { service, ordersRepository, orderItemsRepository };
}

describe('OrderLookupService.lookup', () => {
  it('이름 + 주문번호가 모두 일치하면 해당 주문 한 건을 반환한다', async () => {
    const { service, ordersRepository, orderItemsRepository } = createHarness();
    ordersRepository.findByCustomerNameAndOrderNumber.mockResolvedValue(ORDER_ROW);
    orderItemsRepository.findByOrderId.mockResolvedValue(ORDER_ITEM_ROWS);

    const result = await service.lookup(createDto());

    expect(ordersRepository.findByCustomerNameAndOrderNumber).toHaveBeenCalledWith(
      FAKE_DATABASE,
      '홍길동',
      '0918-0001',
    );
    expect(orderItemsRepository.findByOrderId).toHaveBeenCalledWith(FAKE_DATABASE, 'order-1');
    expect(result.id).toBe('order-1');
    expect(result.items).toEqual([
      {
        menuId: ORDER_ITEM_ROWS[0].menu_id,
        menuName: ORDER_ITEM_ROWS[0].menu_name,
        unitPrice: ORDER_ITEM_ROWS[0].unit_price,
        quantity: ORDER_ITEM_ROWS[0].quantity,
      },
    ]);
  });

  it('이름은 맞고 주문번호가 틀리면(또는 그 반대) ORDER_NOT_FOUND를 던진다', async () => {
    const { service, ordersRepository, orderItemsRepository } = createHarness();
    ordersRepository.findByCustomerNameAndOrderNumber.mockResolvedValue(null);

    await expect(service.lookup(createDto({ orderNumber: '0918-9999' }))).rejects.toMatchObject(
      new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '입력하신 정보와 일치하는 주문이 없습니다.'),
    );
    expect(orderItemsRepository.findByOrderId).not.toHaveBeenCalled();
  });
});
