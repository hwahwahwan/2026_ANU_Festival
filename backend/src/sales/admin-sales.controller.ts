import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin-auth/admin.guard';
import { CurrentAdmin } from '../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../common/contracts/admin-principal';
import { SalesView } from '../common/contracts/sales-view';
import { SalesService } from './sales.service';
import { QuerySalesDto } from './dto/query-sales.dto';
import { SalesThrottlerGuard } from './sales-throttler.guard';

@Controller('admin/sales')
@UseGuards(AdminGuard)
export class AdminSalesController {
  constructor(private readonly salesService: SalesService) {}

  /**
   * 로그인(`POST /admin/auth/login`)과 마찬가지로 매 요청마다 argon2 비밀번호
   * 검증을 하므로 같은 brute-force 방어가 필요해 Throttler를 함께 건다. 다만
   * 이 라우트는 로그인 전용 `ThrottlerGuard`(IP 기준)를 그대로 쓰지 않고
   * `SalesThrottlerGuard`(adminId 기준, `sales-throttler.guard.ts` 참고)를
   * 쓴다 — 여러 운영자가 같은 Wi-Fi/NAT을 공유해도 서로의 카운터가 섞이지
   * 않게 하기 위함이다. 실제 제한 값(횟수/기간)은 `ThrottlerModule`이
   * app.module.ts에서 이미 전역으로 한 번만 등록한 default profile을 그대로
   * 쓴다(admin-auth-rate-limit.ts) — tracker만 다르고 한도 자체는 로그인과
   * 동일하다.
   */
  @Post('query')
  @UseGuards(SalesThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  query(
    @Body() dto: QuerySalesDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<SalesView> {
    return this.salesService.query(admin.adminId, dto.password);
  }
}
