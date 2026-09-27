import { plainToInstance } from 'class-transformer';
import { CreateOrderItemDto } from '../../../src/orders/dto/create-order-item.dto';

describe('CreateOrderItemDto', () => {
  it('menuId를 소문자로 정규화한다 (DB의 UUID 소문자 정규형과 일치시키기 위함)', () => {
    const result = plainToInstance(CreateOrderItemDto, {
      menuId: 'AABBCCDD-1111-1111-1111-111111111111',
      quantity: 1,
    });

    expect(result.menuId).toBe('aabbccdd-1111-1111-1111-111111111111');
  });

  it('이미 소문자인 menuId는 그대로 유지한다', () => {
    const result = plainToInstance(CreateOrderItemDto, {
      menuId: 'aabbccdd-1111-1111-1111-111111111111',
      quantity: 1,
    });

    expect(result.menuId).toBe('aabbccdd-1111-1111-1111-111111111111');
  });
});
