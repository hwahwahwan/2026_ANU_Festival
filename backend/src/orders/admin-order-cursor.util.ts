import { isUUID } from 'class-validator';
import { ApiException } from '../common/filters/api.exception';
import { ERROR_CODE } from '../common/contracts/api-error';

export interface AdminOrderCursor {
  id: string;
}

/**
 * §1-10: cursor는 서버가 발급하는 불투명(opaque) 문자열이다. 클라이언트는
 * 값을 해석하지 않고 다음 요청에 그대로 전달한다.
 *
 * id만 인코딩한다 — createdAt까지 함께 실으면 JS Date를 거치며 마이크로초가
 * 잘려, 같은 밀리초에 커밋된 주문이 다음 페이지에서 조용히 누락되는
 * 문제가 있었다(orders.created_at은 TIMESTAMPTZ, 마이크로초 정밀도).
 * 대신 Repository가 이 id로 해당 행의 created_at을 DB에서 그대로 다시
 * 읽어 비교하므로(orders.repository.ts#findPage) 정밀도 손실이 없다.
 */
export function encodeAdminOrderCursor(cursor: AdminOrderCursor): string {
  const payload = JSON.stringify({ id: cursor.id });

  return Buffer.from(payload, 'utf-8').toString('base64url');
}

export function decodeAdminOrderCursor(cursor: string): AdminOrderCursor {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf-8'),
    );

    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as { id?: unknown }).id !== 'string' ||
      !isUUID((payload as { id: string }).id)
    ) {
      throw new Error('invalid cursor payload shape');
    }

    return { id: (payload as { id: string }).id };
  } catch {
    throw new ApiException(ERROR_CODE.VALIDATION_ERROR, '유효하지 않은 cursor입니다.');
  }
}
