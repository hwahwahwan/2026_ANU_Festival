import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

// argon2 모듈의 named export는 CommonJS 상호운용 특성상 jest.spyOn으로
// 런타임에 재정의할 수 없으므로(non-configurable), verify()만 실제 구현을
// 감싼 jest.fn으로 교체해 호출 여부/횟수를 추적할 수 있게 한다.
jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import { AdminAuthService } from '../../../src/admin-auth/admin-auth.service';
import {
  AdminRecord,
  AdminsRepository,
} from '../../../src/admin-auth/admins.repository';
import { ADMIN_JWT_EXPIRES_IN_SECONDS } from '../../../src/admin-auth/admin-cookie';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';
import { AdminJwtPayload } from '../../../src/common/contracts/admin-principal';

describe('AdminAuthService', () => {
  const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
  const CORRECT_PASSWORD = 'correct-password';

  let admin: AdminRecord;
  let repository: jest.Mocked<AdminsRepository>;
  let jwtService: JwtService;
  let eventEmitter: { emit: jest.Mock };
  let service: AdminAuthService;

  beforeAll(async () => {
    admin = {
      id: ADMIN_ID,
      username: 'admin1',
      passwordHash: await argon2.hash(CORRECT_PASSWORD),
    };
  });

  beforeEach(() => {
    repository = {
      findByUsername: jest.fn(),
      findById: jest.fn(),
    } as unknown as jest.Mocked<AdminsRepository>;

    jwtService = new JwtService({
      secret: 'unit-test-secret',
      signOptions: { expiresIn: ADMIN_JWT_EXPIRES_IN_SECONDS },
    });

    eventEmitter = { emit: jest.fn() };

    service = new AdminAuthService(
      repository,
      jwtService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  describe('login', () => {
    it('아이디/비밀번호가 일치하면 sub=admin.id인 JWT를 반환한다', async () => {
      repository.findByUsername.mockResolvedValue(admin);

      const token = await service.login('admin1', CORRECT_PASSWORD);

      const payload = jwtService.verify<AdminJwtPayload>(token);
      expect(payload.sub).toBe(ADMIN_ID);
    });

    it('발급된 JWT의 유효기간이 ADMIN_JWT_EXPIRES_IN_SECONDS(12시간)와 정확히 일치한다', async () => {
      repository.findByUsername.mockResolvedValue(admin);

      const token = await service.login('admin1', CORRECT_PASSWORD);

      const payload = jwtService.verify<
        AdminJwtPayload & { iat: number; exp: number }
      >(token);
      expect(payload.exp - payload.iat).toBe(ADMIN_JWT_EXPIRES_IN_SECONDS);
    });

    it('존재하지 않는 아이디는 ADMIN_LOGIN_FAILED를 던진다', async () => {
      repository.findByUsername.mockResolvedValue(null);

      try {
        await service.login('no-such-admin', 'whatever');
        fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiException);
        expect((error as ApiException).getResponse()).toMatchObject({
          code: ERROR_CODE.ADMIN_LOGIN_FAILED,
        });
      }
    });

    it('비밀번호가 틀리면 ADMIN_LOGIN_FAILED를 던진다 (존재하지 않는 아이디와 동일한 코드)', async () => {
      repository.findByUsername.mockResolvedValue(admin);

      try {
        await service.login('admin1', 'wrong-password');
        fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiException);
        expect((error as ApiException).getResponse()).toMatchObject({
          code: ERROR_CODE.ADMIN_LOGIN_FAILED,
        });
      }
    });

    it('password_hash가 argon2 형식이 아니어도 500이 아니라 ADMIN_LOGIN_FAILED를 던진다', async () => {
      repository.findByUsername.mockResolvedValue({
        ...admin,
        passwordHash: 'not-a-valid-argon2-hash',
      });

      try {
        await service.login('admin1', CORRECT_PASSWORD);
        fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiException);
        expect((error as ApiException).getResponse()).toMatchObject({
          code: ERROR_CODE.ADMIN_LOGIN_FAILED,
        });
      }
    });

    it('password_hash가 손상되면 warn 로그를 남기되 비밀번호/해시 값은 절대 포함하지 않는다', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      repository.findByUsername.mockResolvedValue({
        ...admin,
        passwordHash: 'not-a-valid-argon2-hash',
      });

      await expect(
        service.login('admin1', CORRECT_PASSWORD),
      ).rejects.toBeInstanceOf(ApiException);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [loggedMessage] = warnSpy.mock.calls[0] as [string];
      expect(loggedMessage).toContain('username=admin1');
      expect(loggedMessage).not.toContain(CORRECT_PASSWORD);
      expect(loggedMessage).not.toContain('not-a-valid-argon2-hash');

      warnSpy.mockRestore();
    });

    it('존재하지 않는 아이디로 로그인해도 실제 계정과 동일하게 argon2 검증을 한 번 수행한다 (타이밍으로 계정 존재 여부 노출 방지)', async () => {
      const verifyMock = argon2.verify as jest.Mock;
      const callsBefore = verifyMock.mock.calls.length;
      repository.findByUsername.mockResolvedValue(null);

      try {
        await service.login('no-such-admin', 'whatever');
        fail('should have thrown');
      } catch {
        // ADMIN_LOGIN_FAILED는 위 테스트에서 이미 검증했으므로 여기서는 생략
      }

      expect(verifyMock.mock.calls.length).toBe(callsBefore + 1);
    });
  });

  describe('verifyAdminPassword', () => {
    it('현재 로그인한 adminId의 비밀번호가 맞으면 true를 반환한다', async () => {
      repository.findById.mockResolvedValue(admin);

      await expect(
        service.verifyAdminPassword(ADMIN_ID, CORRECT_PASSWORD),
      ).resolves.toBe(true);
    });

    it('비밀번호가 틀리면 false를 반환한다', async () => {
      repository.findById.mockResolvedValue(admin);

      await expect(
        service.verifyAdminPassword(ADMIN_ID, 'wrong-password'),
      ).resolves.toBe(false);
    });

    it('adminId에 해당하는 관리자가 없으면 false를 반환한다', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.verifyAdminPassword(ADMIN_ID, CORRECT_PASSWORD),
      ).resolves.toBe(false);
    });

    it('password_hash가 argon2 형식이 아니어도 예외를 던지지 않고 false를 반환한다', async () => {
      repository.findById.mockResolvedValue({
        ...admin,
        passwordHash: 'not-a-valid-argon2-hash',
      });

      await expect(
        service.verifyAdminPassword(ADMIN_ID, CORRECT_PASSWORD),
      ).resolves.toBe(false);
    });
  });

  describe('notifyLogout', () => {
    it('유효한 토큰이면 admin.logged_out 이벤트를 해당 adminId로 발행한다', () => {
      const token = jwtService.sign({ sub: ADMIN_ID });

      service.notifyLogout(token);

      expect(eventEmitter.emit).toHaveBeenCalledWith('admin.logged_out', {
        adminId: ADMIN_ID,
        sessionId: undefined,
      });
    });

    it('토큰에 jti(세션 식별자)가 있으면 그 값을 그대로 sessionId로 실어 이벤트를 발행한다', () => {
      const token = jwtService.sign({ sub: ADMIN_ID, jti: 'session-abc' });

      service.notifyLogout(token);

      expect(eventEmitter.emit).toHaveBeenCalledWith('admin.logged_out', {
        adminId: ADMIN_ID,
        sessionId: 'session-abc',
      });
    });

    it('login()으로 발급한 토큰마다 서로 다른 sessionId(jti)가 부여된다', async () => {
      repository.findByUsername.mockResolvedValue(admin);

      const tokenA = await service.login('admin1', CORRECT_PASSWORD);
      const tokenB = await service.login('admin1', CORRECT_PASSWORD);

      service.notifyLogout(tokenA);
      const firstCallPayload = eventEmitter.emit.mock.calls[0][1] as {
        sessionId: string | undefined;
      };

      service.notifyLogout(tokenB);
      const secondCallPayload = eventEmitter.emit.mock.calls[1][1] as {
        sessionId: string | undefined;
      };

      expect(firstCallPayload.sessionId).toEqual(expect.any(String));
      expect(secondCallPayload.sessionId).toEqual(expect.any(String));
      expect(firstCallPayload.sessionId).not.toBe(secondCallPayload.sessionId);
    });

    it('토큰이 없으면 이벤트를 발행하지 않는다', () => {
      service.notifyLogout(undefined);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('만료된 토큰이면 이벤트를 발행하지 않는다', () => {
      const expiredToken = jwtService.sign(
        { sub: ADMIN_ID },
        { expiresIn: -10 },
      );

      service.notifyLogout(expiredToken);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('변조된 토큰이면 이벤트를 발행하지 않는다', () => {
      const validToken = jwtService.sign({ sub: ADMIN_ID });

      service.notifyLogout(`${validToken}tampered`);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
