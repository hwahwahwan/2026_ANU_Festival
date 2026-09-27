import { OrdersService } from '../../../src/orders/orders.service';
import { DatabaseService } from '../../../src/database/database.service';
import { OrdersRepository, OrderRow } from '../../../src/orders/orders.repository';
import { OrderItemsRepository } from '../../../src/orders/order-items.repository';
import { OrderNumberService } from '../../../src/orders/order-number.service';
import { MenuReader, MenuSnapshot } from '../../../src/common/contracts/menu-reader';
import { OrderEventPublisher } from '../../../src/common/events/order-event.publisher';
import { CreateOrderDto } from '../../../src/orders/dto/create-order.dto';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';
import { computeRequestFingerprint } from '../../../src/orders/order-fingerprint.util';

const MENU_A: MenuSnapshot = {
  id: '11111111-1111-1111-1111-111111111111',
  name: '아망추',
  price: 3500,
  isAvailable: true,
};

const MENU_SOLD_OUT: MenuSnapshot = {
  id: '22222222-2222-2222-2222-222222222222',
  name: '크로플',
  price: 4000,
  isAvailable: false,
};

const FAKE_CLIENT = {} as never;

function createDto(overrides: Partial<CreateOrderDto> = {}): CreateOrderDto {
  return {
    orderRequestId: '550e8400-e29b-41d4-a716-446655440000',
    customerName: '홍길동',
    customerPhone: '010-1234-5678',
    items: [{ menuId: MENU_A.id, quantity: 2 }],
    ...overrides,
  } as CreateOrderDto;
}

function createHarness(menus: MenuSnapshot[]) {
  const database = {
    withTransaction: jest.fn((work: (client: unknown) => Promise<unknown>) =>
      work(FAKE_CLIENT),
    ),
  } as unknown as jest.Mocked<DatabaseService>;

  const ordersRepository = {
    create: jest.fn(),
    findByOrderRequestId: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<OrdersRepository>;

  const orderItemsRepository = {
    createMany: jest.fn(),
    findByOrderId: jest.fn(),
  } as unknown as jest.Mocked<OrderItemsRepository>;

  const orderNumberService = {
    issue: jest.fn().mockResolvedValue('0918-0001'),
  } as unknown as jest.Mocked<OrderNumberService>;

  const menuReader: jest.Mocked<MenuReader> = {
    getSnapshotsForOrder: jest.fn().mockResolvedValue(menus),
  };

  const events: jest.Mocked<OrderEventPublisher> = {
    publish: jest.fn(),
  };

  const service = new OrdersService(
    database,
    ordersRepository,
    orderItemsRepository,
    orderNumberService,
    menuReader,
    events,
  );

  return {
    service,
    database,
    ordersRepository,
    orderItemsRepository,
    orderNumberService,
    menuReader,
    events,
  };
}

describe('OrdersService.create', () => {
  it('정상 주문이면 서버가 계산한 가격으로 order/order_items를 생성하고 orderNumber를 발급한다', async () => {
    const { service, ordersRepository, orderItemsRepository, events } =
      createHarness([MENU_A]);

    ordersRepository.create.mockResolvedValue({
      id: 'order-1',
      order_number: '0918-0001',
      order_request_id: '550e8400-e29b-41d4-a716-446655440000',
      request_fingerprint: 'fp-created',
      customer_name: '홍길동',
      customer_phone: '010-1234-5678',
      status: 'PAYMENT_PENDING',
      total_price: 7000,
      payment_confirmed_at: null,
      created_at: new Date('2026-09-18T00:00:00Z'),
    });
    orderItemsRepository.createMany.mockResolvedValue([
      {
        id: 'item-1',
        order_id: 'order-1',
        menu_id: MENU_A.id,
        menu_name: MENU_A.name,
        unit_price: MENU_A.price,
        quantity: 2,
      },
    ]);

    const result = await service.create(createDto());

    expect(ordersRepository.create).toHaveBeenCalledWith(
      FAKE_CLIENT,
      expect.objectContaining({ totalPrice: 7000, orderNumber: '0918-0001' }),
    );
    expect(result.totalPrice).toBe(7000);
    expect(result.items).toEqual([
      {
        menuId: MENU_A.id,
        menuName: MENU_A.name,
        unitPrice: MENU_A.price,
        quantity: 2,
      },
    ]);
    expect(events.publish).toHaveBeenCalledWith('order.created', {
      orderId: 'order-1',
    });
  });

  it('클라이언트가 보낸 가격/총액은 무시하고 항상 MenuSnapshot 가격으로 계산한다', async () => {
    const { service, ordersRepository, orderItemsRepository } = createHarness([
      MENU_A,
    ]);
    ordersRepository.create.mockResolvedValue({
      id: 'order-1',
      order_number: '0918-0001',
      order_request_id: '550e8400-e29b-41d4-a716-446655440000',
      request_fingerprint: 'fp-created',
      customer_name: '홍길동',
      customer_phone: '010-1234-5678',
      status: 'PAYMENT_PENDING',
      total_price: 3500,
      payment_confirmed_at: null,
      created_at: new Date(),
    });
    orderItemsRepository.createMany.mockResolvedValue([]);

    await service.create(
      createDto({ items: [{ menuId: MENU_A.id, quantity: 1 }] }),
    );

    expect(ordersRepository.create).toHaveBeenCalledWith(
      FAKE_CLIENT,
      expect.objectContaining({ totalPrice: 3500 }),
    );
  });

  it('요청한 menuId 수와 MenuReader가 반환한 메뉴 수가 다르면(존재하지 않는 메뉴) MENU_UNAVAILABLE을 던진다', async () => {
    const { service, ordersRepository } = createHarness([]);

    await expect(service.create(createDto())).rejects.toMatchObject(
      new ApiException(ERROR_CODE.MENU_UNAVAILABLE, '존재하지 않는 메뉴가 포함되어 있습니다.'),
    );
    expect(ordersRepository.create).not.toHaveBeenCalled();
  });

  it('MenuReader가 반환한 menu.id가 요청 menuId와 대소문자 등으로 어긋나 Map에서 못 찾으면(개수는 같아 앞단 검사를 통과) 크래시 대신 MENU_UNAVAILABLE을 던진다', async () => {
    const menuIdWithLetters = 'aabbccdd-1111-1111-1111-111111111111';
    const { service, ordersRepository } = createHarness([
      { ...MENU_A, id: menuIdWithLetters.toUpperCase() },
    ]);

    await expect(
      service.create(
        createDto({ items: [{ menuId: menuIdWithLetters, quantity: 1 }] }),
      ),
    ).rejects.toMatchObject(
      new ApiException(ERROR_CODE.MENU_UNAVAILABLE, '존재하지 않는 메뉴가 포함되어 있습니다.'),
    );
    expect(ordersRepository.create).not.toHaveBeenCalled();
  });

  it('품절된 메뉴가 포함되어 있으면 MENU_UNAVAILABLE을 던지고 주문을 생성하지 않는다', async () => {
    const { service, ordersRepository } = createHarness([MENU_SOLD_OUT]);

    await expect(
      service.create(
        createDto({ items: [{ menuId: MENU_SOLD_OUT.id, quantity: 1 }] }),
      ),
    ).rejects.toMatchObject(
      new ApiException(ERROR_CODE.MENU_UNAVAILABLE, '품절된 메뉴가 포함되어 있습니다.'),
    );
    expect(ordersRepository.create).not.toHaveBeenCalled();
  });

  it('order.created 이벤트는 Transaction(withTransaction) 완료 후에 발행한다', async () => {
    const { service, database, ordersRepository, orderItemsRepository, events } =
      createHarness([MENU_A]);
    ordersRepository.create.mockResolvedValue({
      id: 'order-1',
      order_number: '0918-0001',
      order_request_id: '550e8400-e29b-41d4-a716-446655440000',
      request_fingerprint: 'fp-created',
      customer_name: '홍길동',
      customer_phone: '010-1234-5678',
      status: 'PAYMENT_PENDING',
      total_price: 7000,
      payment_confirmed_at: null,
      created_at: new Date(),
    });
    orderItemsRepository.createMany.mockResolvedValue([]);

    const callOrder: string[] = [];
    database.withTransaction.mockImplementation(async (work) => {
      const result = await work(FAKE_CLIENT);
      callOrder.push('withTransaction resolved');
      return result;
    });
    events.publish.mockImplementation(() => {
      callOrder.push('event published');
    });

    await service.create(createDto());

    expect(callOrder).toEqual(['withTransaction resolved', 'event published']);
  });
});

function existingOrderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'order-existing',
    order_number: '0918-0001',
    order_request_id: '550e8400-e29b-41d4-a716-446655440000',
    request_fingerprint: computeRequestFingerprint({
      customerName: '홍길동',
      customerPhone: '010-1234-5678',
      items: [{ menuId: MENU_A.id, quantity: 2 }],
    }),
    customer_name: '홍길동',
    customer_phone: '010-1234-5678',
    status: 'PAYMENT_PENDING',
    total_price: 7000,
    payment_confirmed_at: null,
    created_at: new Date('2026-09-18T00:00:00Z'),
    ...overrides,
  };
}

function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

describe('OrdersService.create (멱등성)', () => {
  it('같은 orderRequestId + 같은 내용이면 기존 주문을 그대로 반환하고 새로 생성하지 않는다', async () => {
    const { service, ordersRepository, orderItemsRepository, orderNumberService, events } =
      createHarness([MENU_A]);
    const existing = existingOrderRow();
    ordersRepository.findByOrderRequestId.mockResolvedValue(existing);
    orderItemsRepository.findByOrderId.mockResolvedValue([
      {
        id: 'item-1',
        order_id: existing.id,
        menu_id: MENU_A.id,
        menu_name: MENU_A.name,
        unit_price: MENU_A.price,
        quantity: 2,
      },
    ]);

    const result = await service.create(createDto());

    expect(result.id).toBe(existing.id);
    expect(ordersRepository.create).not.toHaveBeenCalled();
    expect(orderNumberService.issue).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('같은 orderRequestId + 다른 내용이면 IDEMPOTENCY_CONFLICT를 던지고 주문을 생성하지 않는다', async () => {
    const { service, ordersRepository } = createHarness([MENU_A]);
    ordersRepository.findByOrderRequestId.mockResolvedValue(existingOrderRow());

    await expect(
      service.create(createDto({ items: [{ menuId: MENU_A.id, quantity: 999 }] })),
    ).rejects.toMatchObject(
      new ApiException(
        ERROR_CODE.IDEMPOTENCY_CONFLICT,
        '이미 다른 내용의 주문 요청이 처리되었습니다.',
      ),
    );
    expect(ordersRepository.create).not.toHaveBeenCalled();
  });

  it('같은 orderRequestId + 같은 items인데 고객 이름이 다르면 다른 사람의 주문으로 보고 IDEMPOTENCY_CONFLICT를 던진다', async () => {
    const { service, ordersRepository } = createHarness([MENU_A]);
    ordersRepository.findByOrderRequestId.mockResolvedValue(existingOrderRow());

    await expect(
      service.create(createDto({ customerName: '다른사람' })),
    ).rejects.toMatchObject(
      new ApiException(
        ERROR_CODE.IDEMPOTENCY_CONFLICT,
        '이미 다른 내용의 주문 요청이 처리되었습니다.',
      ),
    );
    expect(ordersRepository.create).not.toHaveBeenCalled();
  });

  it('같은 orderRequestId + 같은 items인데 전화번호가 다르면 IDEMPOTENCY_CONFLICT를 던진다', async () => {
    const { service, ordersRepository } = createHarness([MENU_A]);
    ordersRepository.findByOrderRequestId.mockResolvedValue(existingOrderRow());

    await expect(
      service.create(createDto({ customerPhone: '010-9999-9999' })),
    ).rejects.toMatchObject(
      new ApiException(
        ERROR_CODE.IDEMPOTENCY_CONFLICT,
        '이미 다른 내용의 주문 요청이 처리되었습니다.',
      ),
    );
    expect(ordersRepository.create).not.toHaveBeenCalled();
  });

  it('같은 요청 안에 동일한 menuId가 중복되면 quantity를 합산해 order_item 한 줄로 저장한다', async () => {
    const { service, ordersRepository, orderItemsRepository } = createHarness([MENU_A]);
    ordersRepository.create.mockResolvedValue({
      id: 'order-1',
      order_number: '0918-0001',
      order_request_id: '550e8400-e29b-41d4-a716-446655440000',
      request_fingerprint: 'fp-created',
      customer_name: '홍길동',
      customer_phone: '010-1234-5678',
      status: 'PAYMENT_PENDING',
      total_price: 17500,
      payment_confirmed_at: null,
      created_at: new Date(),
    });
    orderItemsRepository.createMany.mockResolvedValue([]);

    await service.create(
      createDto({
        items: [
          { menuId: MENU_A.id, quantity: 2 },
          { menuId: MENU_A.id, quantity: 3 },
        ],
      }),
    );

    expect(orderItemsRepository.createMany).toHaveBeenCalledWith(
      FAKE_CLIENT,
      'order-1',
      [
        {
          menuId: MENU_A.id,
          menuName: MENU_A.name,
          unitPrice: MENU_A.price,
          quantity: 5,
        },
      ],
    );
    expect(ordersRepository.create).toHaveBeenCalledWith(
      FAKE_CLIENT,
      expect.objectContaining({ totalPrice: MENU_A.price * 5 }),
    );
  });

  it('동시에 같은 orderRequestId가 INSERT되어 UNIQUE 위반이 나면, 방금 커밋된 주문을 다시 조회해 반환한다', async () => {
    const { service, ordersRepository, orderItemsRepository, events } = createHarness([
      MENU_A,
    ]);
    const existing = existingOrderRow();
    ordersRepository.create.mockRejectedValue(
      uniqueViolation('orders_order_request_id_key'),
    );
    ordersRepository.findByOrderRequestId
      .mockResolvedValueOnce(null) // 최초 조회 시점에는 아직 없었음
      .mockResolvedValueOnce(existing); // INSERT 경합 후 재조회하면 존재함
    orderItemsRepository.findByOrderId.mockResolvedValue([]);

    const result = await service.create(createDto());

    expect(result.id).toBe(existing.id);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('경합 상황에서도 내용이 다르면 IDEMPOTENCY_CONFLICT를 던진다', async () => {
    const { service, ordersRepository } = createHarness([MENU_A]);
    ordersRepository.create.mockRejectedValue(
      uniqueViolation('orders_order_request_id_key'),
    );
    ordersRepository.findByOrderRequestId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingOrderRow());

    await expect(
      service.create(createDto({ items: [{ menuId: MENU_A.id, quantity: 999 }] })),
    ).rejects.toMatchObject(
      new ApiException(
        ERROR_CODE.IDEMPOTENCY_CONFLICT,
        '이미 다른 내용의 주문 요청이 처리되었습니다.',
      ),
    );
  });

  it('orderRequestId와 무관한 다른 UNIQUE 위반은 그대로 전파한다', async () => {
    const { service, ordersRepository } = createHarness([MENU_A]);
    const error = uniqueViolation('orders_order_number_key');
    ordersRepository.create.mockRejectedValue(error);

    await expect(service.create(createDto())).rejects.toBe(error);
  });
});
