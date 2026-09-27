import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { CustomerOrdersController } from '../../../src/orders/customer-orders.controller';
import { OrdersService } from '../../../src/orders/orders.service';
import { OrderLookupService } from '../../../src/orders/order-lookup.service';
import { ApiExceptionFilter } from '../../../src/common/filters/api-exception.filter';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';
import { OrderView } from '../../../src/common/contracts/order-view';

/**
 * 실제 PostgreSQL 없이, OrdersService/OrderLookupService를 mock으로 대체해서
 * Controller 레벨의 HTTP 계약(상태 코드, 검증, 에러 body)만 검증한다.
 */
const ORDER_VIEW: OrderView = {
  id: 'order-1',
  orderNumber: '0918-0001',
  customerName: '홍길동',
  status: 'PAYMENT_PENDING',
  items: [],
  totalPrice: 7000,
  createdAt: '2026-09-18T00:00:00.000Z',
  paymentConfirmedAt: null,
};

describe('CustomerOrdersController /orders/lookup (HTTP 계약)', () => {
  let app: INestApplication;
  const orderLookupService = { lookup: jest.fn() };
  const ordersService = { create: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerOrdersController],
      providers: [
        { provide: OrdersService, useValue: ordersService },
        { provide: OrderLookupService, useValue: orderLookupService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('정상 조회 시 200 OK와 OrderView를 반환한다', async () => {
    orderLookupService.lookup.mockResolvedValue(ORDER_VIEW);

    const response = await request(app.getHttpServer())
      .post('/orders/lookup')
      .send({ customerName: '홍길동', orderNumber: '0918-0001' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(ORDER_VIEW);
  });

  it('일치하는 주문이 없으면 404 ORDER_NOT_FOUND를 반환한다', async () => {
    orderLookupService.lookup.mockRejectedValue(
      new ApiException(
        ERROR_CODE.ORDER_NOT_FOUND,
        '입력하신 정보와 일치하는 주문이 없습니다.',
      ),
    );

    const response = await request(app.getHttpServer())
      .post('/orders/lookup')
      .send({ customerName: '홍길동', orderNumber: '0918-9999' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      code: 'ORDER_NOT_FOUND',
      message: '입력하신 정보와 일치하는 주문이 없습니다.',
    });
  });

  it('customerName이 비어있으면 400 VALIDATION_ERROR를 반환하고 서비스는 호출되지 않는다', async () => {
    const response = await request(app.getHttpServer())
      .post('/orders/lookup')
      .send({ customerName: '', orderNumber: '0918-0001' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(orderLookupService.lookup).not.toHaveBeenCalled();
  });

  it('orderNumber 형식이 MMDD-XXXX가 아니면 400을 반환한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/orders/lookup')
      .send({ customerName: '홍길동', orderNumber: 'abcd-1234' });

    expect(response.status).toBe(400);
    expect(orderLookupService.lookup).not.toHaveBeenCalled();
  });

  it('정의되지 않은 필드(orderId 등)가 포함되면 400을 반환한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/orders/lookup')
      .send({ customerName: '홍길동', orderNumber: '0918-0001', orderId: 'x' });

    expect(response.status).toBe(400);
    expect(orderLookupService.lookup).not.toHaveBeenCalled();
  });

  it('customerName 앞뒤 공백은 제거된 뒤 서비스로 전달된다', async () => {
    orderLookupService.lookup.mockResolvedValue(ORDER_VIEW);

    await request(app.getHttpServer())
      .post('/orders/lookup')
      .send({ customerName: '  홍길동  ', orderNumber: '0918-0001' });

    expect(orderLookupService.lookup).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: '홍길동' }),
    );
  });
});

describe('CustomerOrdersController POST /orders (HTTP 계약)', () => {
  let app: INestApplication;
  const orderLookupService = { lookup: jest.fn() };
  const ordersService = { create: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerOrdersController],
      providers: [
        { provide: OrdersService, useValue: ordersService },
        { provide: OrderLookupService, useValue: orderLookupService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('대문자로 보낸 menuId는 소문자로 정규화된 뒤 OrdersService로 전달된다', async () => {
    ordersService.create.mockResolvedValue(ORDER_VIEW);
    const lowerMenuId = 'aabbccdd-1111-4111-8111-111111111111';

    await request(app.getHttpServer())
      .post('/orders')
      .send({
        orderRequestId: '550e8400-e29b-41d4-a716-446655440000',
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        items: [{ menuId: lowerMenuId.toUpperCase(), quantity: 1 }],
      });

    expect(ordersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ menuId: lowerMenuId, quantity: 1 }],
      }),
    );
  });
});
