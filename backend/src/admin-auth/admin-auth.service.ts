import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as argon2 from 'argon2';
import { ERROR_CODE } from '../common/contracts/api-error';
import { ApiException } from '../common/filters/api.exception';
import { AdminJwtPayload } from '../common/contracts/admin-principal';
import { AdminsRepository } from './admins.repository';
import { verifyAdminJwt } from './verify-admin-jwt';

/**
 * 존재하지 않는 username은 DB 조회만으로 끝나 argon2 검증(수십~100ms)을 건너뛰므로,
 * 그대로 두면 응답 시간 차이로 계정 존재 여부가 노출된다(003_백엔드2_운영실시간.md §7
 * "계정 존재 여부 노출 방지"). 존재하지 않는 계정이어도 이 더미 해시에 대해 항상
 * argon2.verify를 한 번 수행해 두 경우의 소요 시간을 맞춘다. 모듈 로드 시 한 번만
 * 계산해서 재사용한다(요청마다 다시 해싱하지 않는다).
 */
const DUMMY_PASSWORD_HASH = argon2.hash(
  'admin-auth-dummy-password-for-timing-safety',
);

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly adminsRepository: AdminsRepository,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async login(username: string, password: string): Promise<string> {
    const admin = await this.adminsRepository.findByUsername(username);
    const passwordHash = admin ? admin.passwordHash : await DUMMY_PASSWORD_HASH;
    const passwordMatches = await this.verifyPassword(
      passwordHash,
      password,
      `username=${username}`,
    );

    if (!admin || !passwordMatches) {
      throw new ApiException(
        ERROR_CODE.ADMIN_LOGIN_FAILED,
        '아이디 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    // jti: 로그인마다 새로 발급하는 세션(기기) 식별자. 같은 관리자가 다른
    // 기기/탭에서 로그인해도 값이 달라, 로그아웃 시 그 세션의 Socket만 골라
    // 끊을 수 있다(admin-principal.ts 참고).
    const payload: AdminJwtPayload = { sub: admin.id, jti: randomUUID() };
    return this.jwtService.sign(payload);
  }

  /**
   * 로그아웃 시 이 브라우저(=이 JWT 세션)의 관리자 Socket만 즉시 종료한다
   * (003_백엔드2_운영실시간.md §10). 같은 adminId로 다른 기기/탭에서 로그인한
   * Socket은 다른 세션(jti)이므로 영향받지 않는다. Cookie가 없거나 만료·변조된
   * 토큰이면 어떤 세션인지 신뢰할 수 없으므로 조용히 무시한다 — 로그아웃 자체는
   * 이 경우에도 항상 204로 멱등적이다.
   */
  notifyLogout(token: string | undefined): void {
    try {
      const admin = verifyAdminJwt(this.jwtService, token);
      this.eventEmitter.emit('admin.logged_out', {
        adminId: admin.adminId,
        sessionId: admin.sessionId,
      });
    } catch (error) {
      // Cookie 없음/만료·변조 토큰으로 로그아웃을 호출하는 것은 정상적인
      // 상황이라 종료할 Socket이 없는 것뿐이지만, eventEmitter.emit() 리스너
      // (Realtime) 쪽에서 발생하는 예상 밖 예외까지 이 catch가 조용히 삼키므로
      // 원인만 warn으로 남긴다(토큰 값 자체는 남기지 않는다). 로그아웃 자체의
      // 204 응답/멱등성 동작은 이 로그와 무관하게 그대로 유지된다.
      this.logger.warn(
        `관리자 Socket 종료 신호(admin.logged_out)를 보내지 못했습니다. 원인: ${
          error instanceof Error ? error.constructor.name : typeof error
        }`,
      );
    }
  }

  async verifyAdminPassword(
    adminId: string,
    password: string,
  ): Promise<boolean> {
    const admin = await this.adminsRepository.findById(adminId);

    if (!admin) {
      return false;
    }

    return this.verifyPassword(admin.passwordHash, password, `adminId=${adminId}`);
  }

  /**
   * argon2.verify()는 password_hash가 argon2 인코딩 형식이 아니면(손상된 데이터 등)
   * boolean이 아니라 예외를 던진다. 인증 실패는 항상 false로만 표현되어야 하므로
   * (호출부가 그대로 500으로 노출하지 않도록) 여기서 흡수한다. 예외 자체는 원인
   * 파악을 위해 warn 로그로 남기되, 비밀번호나 password_hash 값은 절대 남기지 않고
   * 어떤 계정에서 발생했는지(username/adminId)와 예외 종류만 남긴다.
   */
  private async verifyPassword(
    hash: string,
    password: string,
    context: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch (error) {
      this.logger.warn(
        `argon2 비밀번호 검증이 실패했습니다(${context}). password_hash 형식이 손상되었을 수 있습니다. 원인: ${
          error instanceof Error ? error.constructor.name : typeof error
        }`,
      );
      return false;
    }
  }
}
