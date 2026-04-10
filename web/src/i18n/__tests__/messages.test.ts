import { describe, expect, it } from 'vitest';
import { defineMessage, translateMessage } from '../messages';

describe('translateMessage', () => {
  it('formats descriptor-based translations for stable keys', () => {
    const descriptor = defineMessage('admin.common.refresh', '刷新', 'Refresh');

    expect(translateMessage(descriptor, 'zh-CN')).toBe('刷新');
    expect(translateMessage(descriptor, 'en-US')).toBe('Refresh');
  });

  it('formats descriptor placeholders consistently', () => {
    const descriptor = defineMessage(
      'dashboard.callsLastDays',
      '近 {days} 天调用',
      'Calls in last {days} days',
    );

    expect(translateMessage(descriptor, 'en-US', { days: 14 })).toBe(
      'Calls in last 14 days',
    );
  });

  it('passes raw strings through without bridge translation', () => {
    expect(translateMessage('删除失败', 'en-US')).toBe('删除失败');
    expect(translateMessage('Delete failed', 'zh-CN')).toBe('Delete failed');
  });
});
