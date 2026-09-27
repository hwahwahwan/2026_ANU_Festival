import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { AdminGuard } from '../../../src/admin-auth/admin.guard';

/**
 * 001_백엔드_공통.md §19/§52/§55: Backend 1도 AdminAuthModule을 import해서
 * 자신의 Controller에 `@UseGuards(AdminGuard)`를 붙여 쓸 수 있어야 한다.
 * AdminGuard의 생성자 의존성(JwtService)이 소비 모듈 컨텍스트에서 해석되므로,
 * AdminAuthModule이 JwtModule을 함께 export하지 않으면 이 시나리오에서
 * 부팅 자체가 실패한다.
 */
@Controller('probe')
class ProbeController {
  @UseGuards(AdminGuard)
  @Get()
  ping(): string {
    return 'ok';
  }
}

@Module({
  imports: [AdminAuthModule],
  controllers: [ProbeController],
})
class ConsumerModule {}

describe('AdminGuard를 다른(소비) 모듈에서 사용', () => {
  it('AdminAuthModule을 import한 별도 모듈에서 @UseGuards(AdminGuard)로 정상 부팅된다', async () => {
    // 실제 운영에서는 Backend 1의 모듈도 이 프로젝트의 단일 AppModule 트리
    // 안에서 함께 부팅되므로(001_백엔드_공통.md §37 "단일 NestJS 프로세스"),
    // AppModule 전체 + ConsumerModule을 함께 컴파일해서 검증한다. 이렇게 해야
    // app.module.ts에 전역 등록된 ThrottlerModule(admin-auth.controller.ts의
    // login 라우트가 사용) 의존성도 실제 환경과 동일하게 해석된다.
    await expect(
      Test.createTestingModule({
        imports: [AppModule, ConsumerModule],
      }).compile(),
    ).resolves.toBeDefined();
  });
});
