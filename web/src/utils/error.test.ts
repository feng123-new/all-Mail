import { afterEach, describe, expect, it } from 'vitest';
import { defineMessage } from '../i18n/messages';
import { i18n } from '../i18n/instance';
import { getErrorMessage } from './error';

describe('getErrorMessage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('translates stable backend error codes in the current language', async () => {
    await i18n.changeLanguage('en-US');

    expect(getErrorMessage({ code: 'UNAUTHORIZED' }, '删除失败')).toBe(
      '[UNAUTHORIZED] Authentication has expired. Please sign in again.',
    );
  });

  it('localizes descriptor fallbacks when a backend code is unknown', async () => {
    await i18n.changeLanguage('en-US');

    expect(
      getErrorMessage(
        { code: 'UNKNOWN_CODE' },
        defineMessage('apiKeys.deleteFailed', '删除失败', 'Delete failed'),
      ),
    ).toBe('[UNKNOWN_CODE] Delete failed');
  });

  it('does not bridge raw fallback strings across languages', async () => {
    await i18n.changeLanguage('en-US');

    expect(getErrorMessage({ code: 'UNKNOWN_CODE' }, '删除失败')).toBe(
      '[UNKNOWN_CODE] 删除失败',
    );
  });
});
