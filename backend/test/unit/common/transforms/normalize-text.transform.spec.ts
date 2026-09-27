import { plainToInstance } from 'class-transformer';
import { NormalizeText } from '../../../../src/common/transforms/normalize-text.transform';

class TestDto {
  @NormalizeText()
  name!: string;
}

describe('NormalizeText', () => {
  it('앞뒤 공백을 제거한다', () => {
    const result = plainToInstance(TestDto, { name: '  홍길동  ' });

    expect(result.name).toBe('홍길동');
  });

  it('유니코드를 NFC로 정규화한다 (자모 분리(NFD) 입력도 NFC와 동일한 값이 된다)', () => {
    const nfc = '홍길동';
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd); // 두 표현이 실제로 다른 바이트열임을 전제로 확인

    const result = plainToInstance(TestDto, { name: nfd });

    expect(result.name).toBe(nfc);
  });

  it('문자열이 아닌 값은 그대로 통과시킨다', () => {
    const result = plainToInstance(TestDto, { name: undefined });

    expect(result.name).toBeUndefined();
  });
});
