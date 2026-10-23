import { describe, expect, it } from 'vitest';
import {
  maskSensitive,
  restoreSensitive,
  PII_PROTECT_NOTE,
  type MaskEntity,
} from '../../src/core/mask';

// 夹具（校验器行为已单独验证）：
// 4539148803436467        — Luhn 合法卡号
// 1234567890123456        — Luhn 不合法
// 110101199003078937      — mod-11 合法身份证
// 110101199003078930      — 校验码错误
// 110101189003078937      — 年份 1890 越界（且 Luhn 不合法）
// 110101199013078937      — 月份 13 越界（且 Luhn 不合法）
// 110101215003078937      — 年份 2150 越界（但 Luhn 恰好合法）
// +86 4539 1488 0343 6467 — 16 位数字且恰好通过 Luhn，必须判为 PHONE 而非 CARD

const VISA = '4539148803436467';
const ID_OK = '110101199003078937';

describe('maskSensitive — 五类实体检出', () => {
  it('检出 OpenAI/DeepSeek/Stripe sk- key', () => {
    const key = 'sk-' + 'a1B2c3D4e5F6'.repeat(2); // 24 位
    const { masked, entities } = maskSensitive(`key: ${key} done`);
    expect(entities).toEqual([{ type: 'KEY', serial: 1, value: key }]);
    expect(masked).toBe('key: __PII_KEY_1__ done');
  });

  it('检出 GitHub ghp_ / AWS AKIA / Google AIza key', () => {
    const gh = 'ghp_' + 'A'.repeat(36);
    const aws = 'AKIA' + 'IOSFODNN7EXAMPLE'.slice(0, 16);
    const gg = 'AIza' + 'SyD-4fH_9xQa'.padEnd(35, 'b7');
    for (const [i, key] of [gh, aws, gg].entries()) {
      const { entities } = maskSensitive(`tok=${key}`);
      expect(entities, `fixture #${i}`).toEqual([{ type: 'KEY', serial: 1, value: key }]);
    }
  });

  it('检出 Slack xoxb- token 与 JWT', () => {
    const slack = 'xoxb-1234567890-abcdefghijkl';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0fQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6y';
    for (const key of [slack, jwt]) {
      const { entities } = maskSensitive(`auth ${key}`);
      expect(entities).toEqual([{ type: 'KEY', serial: 1, value: key }]);
    }
  });

  it('检出 EMAIL', () => {
    const { masked, entities } = maskSensitive('联系 alice+tag@example.co.uk 咨询');
    expect(entities).toEqual([
      { type: 'EMAIL', serial: 1, value: 'alice+tag@example.co.uk' },
    ]);
    expect(masked).toBe('联系 __PII_EMAIL_1__ 咨询');
  });

  it('检出 IDCARD（mod-11 + 日期双校验通过）', () => {
    const { masked, entities } = maskSensitive(`身份证 ${ID_OK}`);
    expect(entities).toEqual([{ type: 'IDCARD', serial: 1, value: ID_OK }]);
    expect(masked).toBe('身份证 __PII_IDCARD_1__');
  });

  it('检出 PHONE：中国大陆手机 / 国际格式 / 美式格式', () => {
    expect(maskSensitive('电话 13800138000 急').entities).toEqual([
      { type: 'PHONE', serial: 1, value: '13800138000' },
    ]);
    expect(maskSensitive('call +86 138 0013 8000 now').entities).toEqual([
      { type: 'PHONE', serial: 1, value: '+86 138 0013 8000' },
    ]);
    expect(maskSensitive('at (555) 123-4567 or 555-123-4567').entities).toEqual([
      { type: 'PHONE', serial: 1, value: '(555) 123-4567' },
      { type: 'PHONE', serial: 2, value: '555-123-4567' },
    ]);
  });

  it('检出 CARD（Luhn 合法；含连字符分隔形态）', () => {
    expect(maskSensitive(`卡号 ${VISA} 有效`).entities).toEqual([
      { type: 'CARD', serial: 1, value: VISA },
    ]);
    const hyphen = '4539-1488-0343-6467';
    expect(maskSensitive(`card ${hyphen}`).entities).toEqual([
      { type: 'CARD', serial: 1, value: hyphen },
    ]);
  });
});

describe('maskSensitive — 不误伤（宁可漏检）', () => {
  it('Luhn 拒绝 1234 5678 9012 3456 这类不合法卡号', () => {
    expect(maskSensitive('编号 1234 5678 9012 3456 无效').entities).toEqual([]);
    expect(maskSensitive('编号 1234567890123456 无效').entities).toEqual([]);
  });

  it('千分位财务数字 1,234,567 不误伤', () => {
    const { masked, entities } = maskSensitive('营收 1,234,567 元，支出 9,876,543,210 元');
    expect(entities).toEqual([]);
    expect(masked).toContain('1,234,567');
  });

  it('+86 分组号码即使数字部分过 Luhn 也判 PHONE 不判 CARD', () => {
    const phone = '+86 4539 1488 0343 6467'; // 16 位数字，Luhn 恰好合法
    const { entities } = maskSensitive(`contact ${phone} asap`);
    expect(entities).toEqual([{ type: 'PHONE', serial: 1, value: phone }]);
  });

  it('身份证校验码错误拒收', () => {
    expect(maskSensitive('id 110101199003078930 错').entities).toEqual([]);
  });

  it('身份证出生日期不合理拒收（年份越界 / 月份越界）', () => {
    expect(maskSensitive('a 110101189003078937 b').entities).toEqual([]); // 1890 年
    expect(maskSensitive('a 110101199013078937 b').entities).toEqual([]); // 13 月
    // 2150 年越界但 Luhn 恰好合法：若日期校验失效会被 CARD 捞走
    expect(maskSensitive('a 110101215003078937 b').entities).toEqual([]);
  });

  it('边界环视：18 位数字嵌入更长数字串不命中', () => {
    expect(maskSensitive(`x9${ID_OK}8y`).entities).toEqual([]);
  });

  it('空文本与无命中文本原样返回', () => {
    expect(maskSensitive('')).toEqual({ masked: '', entities: [] });
    const plain = '今天天气不错，适合出门散步。';
    expect(maskSensitive(plain)).toEqual({ masked: plain, entities: [] });
  });
});

describe('maskSensitive — 占位符与计数', () => {
  it('多实体按类独立计数，masked 中不含任何原始敏感值', () => {
    const text = 'a@x.com 和 b@y.com，手机 13800138000 与 13912345678，卡 ' + VISA;
    const { masked, entities } = maskSensitive(text);
    expect(entities).toEqual([
      { type: 'EMAIL', serial: 1, value: 'a@x.com' },
      { type: 'EMAIL', serial: 2, value: 'b@y.com' },
      { type: 'PHONE', serial: 1, value: '13800138000' },
      { type: 'PHONE', serial: 2, value: '13912345678' },
      { type: 'CARD', serial: 1, value: VISA },
    ]);
    expect(masked).toBe(
      '__PII_EMAIL_1__ 和 __PII_EMAIL_2__，手机 __PII_PHONE_1__ 与 __PII_PHONE_2__，卡 __PII_CARD_1__',
    );
    for (const e of entities) expect(masked).not.toContain(e.value);
  });

  it('KEY 优先级高于 EMAIL 抢占重叠区间', () => {
    const key = 'sk-alice@example.com-abcdefghijklmn';
    const { masked, entities } = maskSensitive(`use ${key}`);
    expect(entities).toEqual([{ type: 'KEY', serial: 1, value: key }]);
    expect(masked).toBe('use __PII_KEY_1__');
  });

  it('相邻敏感值替换后偏移正确（从后往前替换）', () => {
    const text = `${ID_OK},${VISA}`;
    const { masked, entities } = maskSensitive(text);
    expect(masked).toBe('__PII_IDCARD_1__,__PII_CARD_1__');
    expect(entities.map((e) => e.value)).toEqual([ID_OK, VISA]);
  });
});

describe('restoreSensitive — 容错形态', () => {
  const entities: MaskEntity[] = [
    { type: 'EMAIL', serial: 1, value: 'alice@example.com' },
    { type: 'PHONE', serial: 1, value: '13800138000' },
  ];

  it('标准形态还原', () => {
    expect(restoreSensitive('写给 __PII_EMAIL_1__ 或拨 __PII_PHONE_1__', entities)).toBe(
      '写给 alice@example.com 或拨 13800138000',
    );
  });

  it('容错：全小写', () => {
    expect(restoreSensitive('x __pii_email_1__ y', entities)).toBe('x alice@example.com y');
  });

  it('容错：大小写混合', () => {
    expect(restoreSensitive('x __Pii_Email_1__ y', entities)).toBe('x alice@example.com y');
  });

  it('容错：下划线旁插空格（含前导 __ 被拆开）', () => {
    expect(restoreSensitive('x __ PII_EMAIL_1__ y', entities)).toBe('x alice@example.com y');
    expect(restoreSensitive('x __PII_ EMAIL_1__ y', entities)).toBe('x alice@example.com y');
    expect(restoreSensitive('x __PII_EMAIL _1__ y', entities)).toBe('x alice@example.com y');
    expect(restoreSensitive('x __PII_EMAIL_1 __ y', entities)).toBe('x alice@example.com y');
    expect(restoreSensitive('x _ _PII _ EMAIL _ 1_ _ y', entities)).toBe(
      'x alice@example.com y',
    );
  });

  it('容错：尾部下划线丢失', () => {
    expect(restoreSensitive('x __PII_EMAIL_1 y', entities)).toBe('x alice@example.com y');
  });

  it('serial 降序 + (?!\\d)：_1 不误吞 _11', () => {
    const many: MaskEntity[] = [
      { type: 'EMAIL', serial: 1, value: 'one@x.com' },
      { type: 'EMAIL', serial: 11, value: 'eleven@x.com' },
    ];
    expect(restoreSensitive('__PII_EMAIL_1__ & __PII_EMAIL_11__', many)).toBe(
      'one@x.com & eleven@x.com',
    );
  });

  it('value 含 $& 等特殊字符时按字面还原（函数回调防 $ 解释）', () => {
    const special: MaskEntity[] = [{ type: 'KEY', serial: 1, value: 'sk-$&-$`-abc' }];
    expect(restoreSensitive('token: __PII_KEY_1__!', special)).toBe('token: sk-$&-$`-abc!');
  });

  it('找不到占位符的实体跳过，其余正常还原', () => {
    expect(restoreSensitive('只有 __PII_PHONE_1__ 出现', entities)).toBe(
      '只有 13800138000 出现',
    );
  });

  it('空 entities / 空文本直接返回原文', () => {
    expect(restoreSensitive('no change', [])).toBe('no change');
    expect(restoreSensitive('', entities)).toBe('');
  });

  it('mask→翻译改写→restore 端到端闭环', () => {
    const src = `请把账单寄到 bob@corp.com，或致电 +86 138 0013 8000，卡号 ${VISA}`;
    const { masked, entities: es } = maskSensitive(src);
    // 模拟引擎：原样保留占位符，但把周围文本“翻译”了，并弄乱一处占位符大小写
    const fakeTranslated = masked
      .replace('请把账单寄到 ', 'send the bill to ')
      .replace('，或致电 ', ', or call ')
      .replace('，卡号 ', ', card ')
      .replace('__PII_EMAIL_1__', '__pii_email_1__');
    const restored = restoreSensitive(fakeTranslated, es);
    expect(restored).toBe(
      `send the bill to bob@corp.com, or call +86 138 0013 8000, card ${VISA}`,
    );
  });
});

describe('PII_PROTECT_NOTE', () => {
  it('是给 LLM 的保护句，提及 __PII_ 占位符且要求原样保留', () => {
    expect(typeof PII_PROTECT_NOTE).toBe('string');
    expect(PII_PROTECT_NOTE).toContain('__PII_');
    expect(PII_PROTECT_NOTE.length).toBeGreaterThan(50);
    expect(PII_PROTECT_NOTE.toLowerCase()).toMatch(/unchanged|as-is|keep/);
  });
});
