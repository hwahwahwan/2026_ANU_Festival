import { HttpException } from '@nestjs/common';
import { ErrorCode, ERROR_CODE_HTTP_STATUS } from '../contracts/api-error';

export class ApiException extends HttpException {
  constructor(code: ErrorCode, message: string) {
    super({ code, message }, ERROR_CODE_HTTP_STATUS[code]);
  }
}
