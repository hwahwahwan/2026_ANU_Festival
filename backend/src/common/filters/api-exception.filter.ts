import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiErrorBody, ERROR_CODE } from '../contracts/api-error';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.resolve(exception);

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception);
    }

    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    body: ApiErrorBody;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (this.isApiErrorBody(payload)) {
        return { status, body: payload };
      }

      return {
        status,
        body: {
          code: this.mapStatusToErrorCode(status),
          message: this.extractValidationMessage(payload, exception.message),
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ERROR_CODE.INTERNAL_ERROR,
        message: '서버 오류가 발생했습니다.',
      },
    };
  }

  private mapStatusToErrorCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODE.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODE.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODE.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODE.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODE.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODE.TOO_MANY_REQUESTS;
      default:
        return ERROR_CODE.INTERNAL_ERROR;
    }
  }

  private isApiErrorBody(payload: unknown): payload is ApiErrorBody {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'code' in payload &&
      'message' in payload
    );
  }

  private extractValidationMessage(payload: unknown, fallback: string): string {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload
    ) {
      const { message } = payload as { message: unknown };

      if (Array.isArray(message)) {
        return message.join(', ');
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    return fallback;
  }
}
