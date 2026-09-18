import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../../src/config/env.validation';
import { DatabaseModule } from '../../src/database/database.module';
import { DatabaseService } from '../../src/database/database.service';
import { OrdersRepository } from '../../src/orders/orders.repository';
import { OrderItemsRepository } from '../../src/orders/order-items.repository';
import { OrderNumberService } from '../../src/orders/order-number.service';

/**
 * 실제 로컬 PostgreSQL(festival DB)의 orders/order_items/order_daily_counters
 * 테이블에 대해 검증한다.
 *
 * 이 테스트가 만든 order만 정확히 골라서 지운다 (테이블 전체 DELETE 금지 —
 * 과거 guests 통합 테스트에서 테이블 전체를 DELETE하던 방식이 공유 DB에서
 * 위험하다는 리뷰 지적이 있었음).
 */
describe('Orders 관련 Repository (실제 PostgreSQL integration)', () => {
  let databaseService: DatabaseService;
  let ordersRepository: OrdersRepository;
  let orderItemsRepository: OrderItemsRepository;
  let orderNumberService: OrderNumberService;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        DatabaseModule,
      ],
      providers: [OrdersRepository, OrderItemsRepository, OrderNumberService],
    }).compile();

    databaseService = moduleRef.get(DatabaseService);
    ordersRepository = moduleRef.get(OrdersRepository);
    orderItemsRepository = moduleRef.get(OrderItemsRepository);
    orderNumberService = moduleRef.get(OrderNumberService);
  });

  afterEach(async () => {
    if (createdOrderIds.length === 0) {
      return;
    }
    await databaseService.query(
      `DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`,
      [createdOrderIds],
    );
    await databaseService.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
      createdOrderIds,
    ]);
    createdOrderIds.length = 0;
  });

  afterAll(async () => {
    await databaseService.onApplicationShutdown();
  });

  async function createOrderWithItems(
    orderRequestId: string,
    customerName = '홍길동',
  ) {
    return databaseService.withTransaction(async (client) => {
      const orderNumber = await orderNumberService.issue(client);
      const order = await ordersRepository.create(client, {
        orderNumber,
        orderRequestId,
        customerName,
        customerPhone: '010-1234-5678',
        totalPrice: 7000,
      });
      createdOrderIds.push(order.id);

      const items = await orderItemsRepository.createMany(client, order.id, [
        {
          menuId: '11111111-1111-1111-1111-111111111111',
          menuName: '아망추',
          unitPrice: 3500,
          quantity: 2,
        },
      ]);

      return { order, items };
    });
  }

  it('[1] 정상 주문을 실제로 INSERT하고 MMDD-XXXX 형식의 주문번호를 발급한다', async () => {
    const { order } = await createOrderWithItems(
      '550e8400-e29b-41d4-a716-446655440001',
    );

    expect(order.order_number).toMatch(/^\d{4}-\d{4,}$/);
    expect(order.status).toBe('PAYMENT_PENDING');
    expect(order.total_price).toBe(7000);
  });

  it('[2] order_items가 order_id로 실제 연결되어 저장된다', async () => {
    const { order, items } = await createOrderWithItems(
      '550e8400-e29b-41d4-a716-446655440002',
    );

    expect(items).toHaveLength(1);
    expect(items[0].order_id).toBe(order.id);
    expect(items[0].menu_name).toBe('아망추');
  });

  it('[3] 같은 orderRequestId로 두 번 INSERT를 시도하면 UNIQUE 제약으로 실패한다', async () => {
    const requestId = '550e8400-e29b-41d4-a716-446655440003';
    await createOrderWithItems(requestId);

    await expect(createOrderWithItems(requestId)).rejects.toThrow();
  });

  it('[4] 연속 발급된 주문번호는 같은 날짜 안에서 순번이 증가한다', async () => {
    const { order: first } = await createOrderWithItems(
      '550e8400-e29b-41d4-a716-446655440004',
    );
    const { order: second } = await createOrderWithItems(
      '550e8400-e29b-41d4-a716-446655440005',
    );

    const firstSeq = Number(first.order_number.split('-')[1]);
    const secondSeq = Number(second.order_number.split('-')[1]);

    expect(secondSeq).toBe(firstSeq + 1);
  });

  it('[5] 유효하지 않은 status 값은 DB CHECK 제약으로 거부된다', async () => {
    await expect(
      databaseService.query(
        `INSERT INTO orders
           (order_number, order_request_id, customer_name, customer_phone, status, total_price)
         VALUES ('9999-9999', gen_random_uuid(), '홍길동', '010-0000-0000', 'INVALID_STATUS', 1000)`,
      ),
    ).rejects.toThrow();
  });

  it('[6] quantity가 0 이하인 order_item은 DB CHECK 제약으로 거부된다', async () => {
    const { order } = await createOrderWithItems(
      '550e8400-e29b-41d4-a716-446655440006',
    );

    await expect(
      databaseService.query(
        `INSERT INTO order_items (order_id, menu_id, menu_name, unit_price, quantity)
         VALUES ($1, '11111111-1111-1111-1111-111111111111', '아망추', 3500, 0)`,
        [order.id],
      ),
    ).rejects.toThrow();
  });
});
