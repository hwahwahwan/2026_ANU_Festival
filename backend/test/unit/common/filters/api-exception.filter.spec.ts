import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ApiExceptionFilter } from '../../../../src/common/filters/api-exception.filter';
import { ApiException } from '../../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../../src/common/contracts/api-error';

function createMockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('ApiExceptionFilter', () => {
  let filter: ApiExceptionFilter;

  beforeEach(() => {
    filter = new ApiExceptionFilter();
  });

  it('400 BadRequestException(ValidationPipe)을 VALIDATION_ERROR로 매핑한다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(
      new BadRequestException(['a must not be empty', 'b must be a number']),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.VALIDATION_ERROR,
      message: 'a must not be empty, b must be a number',
    });
  });

  it('401 UnauthorizedException을 UNAUTHORIZED로 매핑한다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new UnauthorizedException(), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.UNAUTHORIZED,
      message: 'Unauthorized',
    });
  });

  it('403 ForbiddenException을 FORBIDDEN으로 매핑한다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new ForbiddenException(), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.FORBIDDEN,
      message: 'Forbidden',
    });
  });

  it('404 NotFoundException(매칭되지 않은 라우트 포함)을 NOT_FOUND로 매핑한다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new NotFoundException(), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.NOT_FOUND,
      message: 'Not Found',
    });
  });

  it('409 ConflictException을 CONFLICT로 매핑한다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new ConflictException(), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.CONFLICT,
      message: 'Conflict',
    });
  });

  it('429 ThrottlerException(rate limit)을 TOO_MANY_REQUESTS로 매핑한다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new ThrottlerException(), host);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.TOO_MANY_REQUESTS,
      message: expect.any(String),
    });
  });

  it('매핑표에 없는 상태코드는 INTERNAL_ERROR로 매핑한다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new HttpException('teapot', 418), host);

    expect(status).toHaveBeenCalledWith(418);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.INTERNAL_ERROR,
      message: 'teapot',
    });
  });

  it('예상하지 못한 서버 오류(HttpException이 아닌 예외)는 500 INTERNAL_ERROR로 응답하고 내부 메시지를 노출하지 않는다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new Error('연결 실패: password authentication failed'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.INTERNAL_ERROR,
      message: '서버 오류가 발생했습니다.',
    });
  });

  it('ApiException으로 던진 도메인 error code는 그대로 보존된다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(
      new ApiException(ERROR_CODE.ORDER_STATE_CONFLICT, '주문 상태가 충돌합니다.'),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.ORDER_STATE_CONFLICT,
      message: '주문 상태가 충돌합니다.',
    });
  });

  it('ApiException(ADMIN_UNAUTHORIZED)도 도메인 code를 잃지 않는다', () => {
    const { host, status, json } = createMockHost();

    filter.catch(
      new ApiException(ERROR_CODE.ADMIN_UNAUTHORIZED, '관리자 인증이 필요합니다.'),
      host,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      code: ERROR_CODE.ADMIN_UNAUTHORIZED,
      message: '관리자 인증이 필요합니다.',
    });
  });
});
