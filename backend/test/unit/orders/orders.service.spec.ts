import { OrdersService } from '../../../src/orders/orders.service';
import { DatabaseService } from '../../../src/database/database.service';
import { OrdersRepository, OrderRow } from '../../../src/orders/orders.repository';
import { OrderItemsRepository } from '../../../src/orders/order-items.repository';
import { OrderHistoryRepository } from '../../../src/orders/order-history.repository';
import { OrderNumberService } from '../../../src/orders/order-number.service';
import { MenuReader, MenuSnapshot } from '../../../src/common/contracts/menu-reader';
import { OrderEventPublisher } from '../../../src/common/events/order-event.publisher';
import { CreateOrderDto } from '../../../src/orders/dto/create-order.dto';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';
import { computeRequestFingerprint } from '../../../src/orders/order-fingerprint.util';
import { encodeAdminOrderCursor } from '../../../src/orders/admin-order-cursor.util';
import { AuthenticatedAdmin } from '../../../src/common/contracts/admin-principal';

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
    findPage: jest.fn(),
    findById: jest.fn(),
    findByIdForUpdate: jest.fn(),
    updateStatus: jest.fn(),
  } as unknown as jest.Mocked<OrdersRepository>;

  const orderItemsRepository = {
    createMany: jest.fn(),
    findByOrderId: jest.fn().mockResolvedValue([]),
    findByOrderIds: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<OrderItemsRepository>;

  const orderHistoryRepository = {
    create: jest.fn(),
    findByOrderId: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<OrderHistoryRepository>;

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
    orderHistoryRepository,
    orderNumberService,
    menuReader,
    events,
  );

  return {
    service,
    database,
    ordersRepository,
    orderItemsRepository,
    orderHistoryRepository,
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

function orderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'order-1',
    order_number: '0918-0001',
    order_request_id: '550e8400-e29b-41d4-a716-446655440000',
    request_fingerprint: 'fp-1',
    customer_name: '홍길동',
    customer_phone: '010-1234-5678',
    status: 'PAYMENT_PENDING',
    total_price: 7000,
    payment_confirmed_at: null,
    created_at: new Date('2026-09-18T00:00:00Z'),
    ...overrides,
  };
}

describe('OrdersService.listForAdmin', () => {
  it('기본 limit(20)으로 조회하고, 결과가 limit 이하면 nextCursor는 null이다', async () => {
    const { service, ordersRepository } = createHarness([]);
    const rows = [orderRow({ id: 'order-1' }), orderRow({ id: 'order-2' })];
    ordersRepository.findPage.mockResolvedValue(rows);

    const result = await service.listForAdmin({});

    expect(ordersRepository.findPage).toHaveBeenCalledWith(
      expect.anything(),
      21,
      undefined,
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: 'order-1', customerPhone: '010-1234-5678' });
    expect(result.nextCursor).toBeNull();
  });

  it('Repository가 limit+1건을 반환하면(더 있음) limit건만 반환하고 nextCursor를 발급한다', async () => {
    const { service, ordersRepository } = createHarness([]);
    const rows = [
      orderRow({ id: 'order-1', created_at: new Date('2026-09-18T02:00:00Z') }),
      orderRow({ id: 'order-2', created_at: new Date('2026-09-18T01:00:00Z') }),
    ];
    ordersRepository.findPage.mockResolvedValue(rows);

    const result = await service.listForAdmin({ limit: 1 });

    expect(ordersRepository.findPage).toHaveBeenCalledWith(expect.anything(), 2, undefined);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('order-1');
    expect(result.nextCursor).not.toBeNull();
  });

  it('cursor를 넘기면 디코딩해서 Repository에 before로 전달한다', async () => {
    const { service, ordersRepository } = createHarness([]);
    ordersRepository.findPage.mockResolvedValue([]);
    const cursorOrderId = '99999999-9999-4999-8999-999999999999';
    const cursor = encodeAdminOrderCursor({ id: cursorOrderId });

    await service.listForAdmin({ cursor });

    expect(ordersRepository.findPage).toHaveBeenCalledWith(expect.anything(), 21, {
      id: cursorOrderId,
    });
  });

  it('주문이 하나도 없으면 빈 목록과 null cursor를 반환하고 order_items 조회를 하지 않는다', async () => {
    const { service, ordersRepository, orderItemsRepository } = createHarness([]);
    ordersRepository.findPage.mockResolvedValue([]);

    const result = await service.listForAdmin({});

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(orderItemsRepository.findByOrderIds).toHaveBeenCalledWith(
      expect.anything(),
      [],
    );
  });

  it('각 주문의 items를 order_id로 정확히 그룹핑해서 매핑한다', async () => {
    const { service, ordersRepository, orderItemsRepository } = createHarness([]);
    ordersRepository.findPage.mockResolvedValue([
      orderRow({ id: 'order-1' }),
      orderRow({ id: 'order-2' }),
    ]);
    orderItemsRepository.findByOrderIds.mockResolvedValue([
      {
        id: 'item-1',
        order_id: 'order-1',
        menu_id: MENU_A.id,
        menu_name: MENU_A.name,
        unit_price: MENU_A.price,
        quantity: 1,
      },
      {
        id: 'item-2',
        order_id: 'order-2',
        menu_id: MENU_A.id,
        menu_name: MENU_A.name,
        unit_price: MENU_A.price,
        quantity: 3,
      },
    ]);

    const result = await service.listForAdmin({});

    expect(result.items.find((o) => o.id === 'order-1')?.items).toEqual([
      { menuId: MENU_A.id, menuName: MENU_A.name, unitPrice: MENU_A.price, quantity: 1 },
    ]);
    expect(result.items.find((o) => o.id === 'order-2')?.items).toEqual([
      { menuId: MENU_A.id, menuName: MENU_A.name, unitPrice: MENU_A.price, quantity: 3 },
    ]);
  });
});

const ADMIN: AuthenticatedAdmin = {
  adminId: 'admin-1',
  expiresAt: Date.now() + 60_000,
  sessionId: 'session-1',
};

describe('OrdersService.confirmPayment', () => {
  it('PAYMENT_PENDING 주문을 ACCEPTED로 전환하고 payment_confirmed_at을 기록하며 History를 남긴다', async () => {
    const { service, ordersRepository, orderItemsRepository, orderHistoryRepository, events } =
      createHarness([]);
    const pending = orderRow({ status: 'PAYMENT_PENDING', payment_confirmed_at: null });
    const accepted = orderRow({
      status: 'ACCEPTED',
      payment_confirmed_at: new Date('2026-09-18T01:00:00Z'),
    });
    ordersRepository.findByIdForUpdate.mockResolvedValue(pending);
    ordersRepository.updateStatus.mockResolvedValue(accepted);
    orderItemsRepository.findByOrderId.mockResolvedValue([]);

    const result = await service.confirmPayment('order-1', ADMIN);

    expect(ordersRepository.findByIdForUpdate).toHaveBeenCalledWith(FAKE_CLIENT, 'order-1');
    expect(ordersRepository.updateStatus).toHaveBeenCalledWith(
      FAKE_CLIENT,
      'order-1',
      'ACCEPTED',
    );
    expect(orderHistoryRepository.create).toHaveBeenCalledWith(FAKE_CLIENT, {
      orderId: 'order-1',
      action: 'PAYMENT_CONFIRMED',
      fromStatus: 'PAYMENT_PENDING',
      toStatus: 'ACCEPTED',
      actorType: 'ADMIN',
      actorId: 'admin-1',
    });
    expect(result.customerPhone).toBe('010-1234-5678');
    expect(result.paymentConfirmedAt).toBe('2026-09-18T01:00:00.000Z');
    expect(events.publish).toHaveBeenCalledWith('order.updated', {
      orderId: 'order-1',
      status: 'ACCEPTED',
    });
  });

  it('주문이 없으면 ORDER_NOT_FOUND를 던지고 아무것도 바꾸지 않는다', async () => {
    const { service, ordersRepository, events } = createHarness([]);
    ordersRepository.findByIdForUpdate.mockResolvedValue(null);

    await expect(service.confirmPayment('missing', ADMIN)).rejects.toMatchObject(
      new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.'),
    );
    expect(ordersRepository.updateStatus).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it.each(['ACCEPTED', 'COOKING', 'READY', 'COMPLETED', 'CANCELLED'] as const)(
    'PAYMENT_PENDING이 아니면(%s) ORDER_STATE_CONFLICT를 던지고 아무것도 바꾸지 않는다',
    async (status) => {
      const { service, ordersRepository, events } = createHarness([]);
      ordersRepository.findByIdForUpdate.mockResolvedValue(orderRow({ status }));

      await expect(service.confirmPayment('order-1', ADMIN)).rejects.toMatchObject(
        new ApiException(ERROR_CODE.ORDER_STATE_CONFLICT, '입금 확인할 수 없는 주문 상태입니다.'),
      );
      expect(ordersRepository.updateStatus).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    },
  );
});

describe('OrdersService.cancel', () => {
  it('PAYMENT_PENDING 주문을 CANCELLED로 전환하고 History를 남긴다', async () => {
    const { service, ordersRepository, orderItemsRepository, orderHistoryRepository, events } =
      createHarness([]);
    const pending = orderRow({ status: 'PAYMENT_PENDING' });
    const cancelled = orderRow({ status: 'CANCELLED' });
    ordersRepository.findByIdForUpdate.mockResolvedValue(pending);
    ordersRepository.updateStatus.mockResolvedValue(cancelled);
    orderItemsRepository.findByOrderId.mockResolvedValue([]);

    const result = await service.cancel('order-1', ADMIN);

    expect(ordersRepository.updateStatus).toHaveBeenCalledWith(
      FAKE_CLIENT,
      'order-1',
      'CANCELLED',
    );
    expect(orderHistoryRepository.create).toHaveBeenCalledWith(FAKE_CLIENT, {
      orderId: 'order-1',
      action: 'CANCELLED',
      fromStatus: 'PAYMENT_PENDING',
      toStatus: 'CANCELLED',
      actorType: 'ADMIN',
      actorId: 'admin-1',
    });
    expect(result.status).toBe('CANCELLED');
    expect(events.publish).toHaveBeenCalledWith('order.updated', {
      orderId: 'order-1',
      status: 'CANCELLED',
    });
  });

  it('주문이 없으면 ORDER_NOT_FOUND를 던진다', async () => {
    const { service, ordersRepository, events } = createHarness([]);
    ordersRepository.findByIdForUpdate.mockResolvedValue(null);

    await expect(service.cancel('missing', ADMIN)).rejects.toMatchObject(
      new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.'),
    );
    expect(ordersRepository.updateStatus).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it.each(['ACCEPTED', 'COOKING', 'READY', 'COMPLETED', 'CANCELLED'] as const)(
    'PAYMENT_PENDING이 아니면(%s) ORDER_STATE_CONFLICT를 던지고 아무것도 바꾸지 않는다',
    async (status) => {
      const { service, ordersRepository, events } = createHarness([]);
      ordersRepository.findByIdForUpdate.mockResolvedValue(orderRow({ status }));

      await expect(service.cancel('order-1', ADMIN)).rejects.toMatchObject(
        new ApiException(ERROR_CODE.ORDER_STATE_CONFLICT, '취소할 수 없는 주문 상태입니다.'),
      );
      expect(ordersRepository.updateStatus).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    },
  );
});

describe('OrdersService.changeStatus', () => {
  it.each([
    ['ACCEPTED', 'COOKING', 'COOKING_STARTED'],
    ['COOKING', 'READY', 'READY'],
    ['READY', 'COMPLETED', 'COMPLETED'],
  ] as const)(
    '%s → %s 전이는 허용되고 action %s로 History가 남는다',
    async (from, to, action) => {
      const { service, ordersRepository, orderItemsRepository, orderHistoryRepository, events } =
        createHarness([]);
      ordersRepository.findByIdForUpdate.mockResolvedValue(orderRow({ status: from }));
      ordersRepository.updateStatus.mockResolvedValue(orderRow({ status: to }));
      orderItemsRepository.findByOrderId.mockResolvedValue([]);

      const result = await service.changeStatus('order-1', to, ADMIN);

      expect(ordersRepository.updateStatus).toHaveBeenCalledWith(FAKE_CLIENT, 'order-1', to);
      expect(orderHistoryRepository.create).toHaveBeenCalledWith(
        FAKE_CLIENT,
        expect.objectContaining({ action, fromStatus: from, toStatus: to }),
      );
      expect(result.status).toBe(to);
      expect(events.publish).toHaveBeenCalledWith('order.updated', {
        orderId: 'order-1',
        status: to,
      });
    },
  );

  it.each([
    ['PAYMENT_PENDING', 'COOKING'],
    ['ACCEPTED', 'READY'],
    ['READY', 'COOKING'],
    ['COMPLETED', 'READY'],
    ['CANCELLED', 'COOKING'],
  ] as const)('%s → %s 전이는 거절되고 ORDER_STATE_CONFLICT를 던진다', async (from, to) => {
    const { service, ordersRepository, events } = createHarness([]);
    ordersRepository.findByIdForUpdate.mockResolvedValue(orderRow({ status: from }));

    await expect(service.changeStatus('order-1', to, ADMIN)).rejects.toMatchObject(
      new ApiException(
        ERROR_CODE.ORDER_STATE_CONFLICT,
        '현재 주문 상태에서 허용되지 않는 상태 변경입니다.',
      ),
    );
    expect(ordersRepository.updateStatus).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('주문이 없으면 ORDER_NOT_FOUND를 던진다', async () => {
    const { service, ordersRepository } = createHarness([]);
    ordersRepository.findByIdForUpdate.mockResolvedValue(null);

    await expect(service.changeStatus('missing', 'COOKING', ADMIN)).rejects.toMatchObject(
      new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.'),
    );
  });
});

describe('OrdersService.getHistory', () => {
  it('주문이 존재하면 History를 시간순으로 매핑해 반환한다', async () => {
    const { service, ordersRepository, orderHistoryRepository } = createHarness([]);
    ordersRepository.findById.mockResolvedValue(orderRow());
    orderHistoryRepository.findByOrderId.mockResolvedValue([
      {
        id: 'history-1',
        order_id: 'order-1',
        action: 'ORDER_CREATED',
        from_status: null,
        to_status: 'PAYMENT_PENDING',
        actor_type: 'CUSTOMER',
        actor_id: null,
        occurred_at: new Date('2026-09-18T00:00:00Z'),
        reason: null,
        metadata: null,
      },
    ]);

    const result = await service.getHistory('order-1');

    expect(result).toEqual([
      {
        id: 'history-1',
        action: 'ORDER_CREATED',
        fromStatus: null,
        toStatus: 'PAYMENT_PENDING',
        actorType: 'CUSTOMER',
        actorId: null,
        occurredAt: '2026-09-18T00:00:00.000Z',
        reason: null,
        metadata: null,
      },
    ]);
  });

  it('주문이 없으면 ORDER_NOT_FOUND를 던지고 History를 조회하지 않는다', async () => {
    const { service, ordersRepository, orderHistoryRepository } = createHarness([]);
    ordersRepository.findById.mockResolvedValue(null);

    await expect(service.getHistory('missing')).rejects.toMatchObject(
      new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.'),
    );
    expect(orderHistoryRepository.findByOrderId).not.toHaveBeenCalled();
  });
});
