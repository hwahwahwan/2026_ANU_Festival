import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { ERROR_CODE } from '../common/contracts/api-error';
import { ApiException } from '../common/filters/api.exception';
import { AdminJwtPayload } from '../common/contracts/admin-principal';
import { AdminsRepository } from './admins.repository';

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

    const payload: AdminJwtPayload = { sub: admin.id };
    return this.jwtService.sign(payload);
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
