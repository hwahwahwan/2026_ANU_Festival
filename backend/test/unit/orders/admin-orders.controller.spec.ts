import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminOrdersController } from '../../../src/orders/admin-orders.controller';
import { OrdersService } from '../../../src/orders/orders.service';
import { AdminGuard } from '../../../src/admin-auth/admin.guard';
import { ApiExceptionFilter } from '../../../src/common/filters/api-exception.filter';
import { AdminOrderListView } from '../../../src/common/contracts/order-view';

/**
 * 실제 PostgreSQL/AdminGuard 없이, OrdersService를 mock으로 대체해서
 * Controller 레벨의 HTTP 계약(쿼리 바인딩, 상태 코드)만 검증한다.
 * 실제 인증/DB를 포함한 계약은 admin-orders.integration.spec.ts가 담당한다.
 */
const EMPTY_LIST: AdminOrderListView = { items: [], nextCursor: null };

describe('AdminOrdersController GET /admin/orders (HTTP 계약)', () => {
  let app: INestApplication;
  const ordersService = { listForAdmin: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminOrdersController],
      providers: [{ provide: OrdersService, useValue: ordersService }],
    })
      .overrideGuard(AdminGuard)
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

  it('쿼리 없이 요청하면 cursor/limit 모두 undefined로 서비스에 전달된다', async () => {
    ordersService.listForAdmin.mockResolvedValue(EMPTY_LIST);

    const response = await request(app.getHttpServer()).get('/admin/orders');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(EMPTY_LIST);
    expect(ordersService.listForAdmin).toHaveBeenCalledWith({});
  });

  it('limit 쿼리 문자열을 숫자로 변환해서 서비스에 전달한다', async () => {
    ordersService.listForAdmin.mockResolvedValue(EMPTY_LIST);

    await request(app.getHttpServer()).get('/admin/orders').query({ limit: '10' });

    expect(ordersService.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('limit이 정수가 아니면 400 VALIDATION_ERROR를 반환한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/orders')
      .query({ limit: 'abc' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(ordersService.listForAdmin).not.toHaveBeenCalled();
  });

  it('정의되지 않은 쿼리 필드가 있으면 400을 반환한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/orders')
      .query({ status: 'ACCEPTED' });

    expect(response.status).toBe(400);
    expect(ordersService.listForAdmin).not.toHaveBeenCalled();
  });
});
