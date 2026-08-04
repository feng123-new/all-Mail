import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./core', () => ({
  requestDelete: vi.fn(),
  requestGet: vi.fn(),
  requestPost: vi.fn(),
  requestPut: vi.fn(),
}));

import { apiKeyApi } from './admin';
import { requestPost, requestPut } from './core';

describe('apiKeyApi cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates allocation statistics after pool or mailbox-scope mutations', () => {
    apiKeyApi.resetAllocation(7, 'priority');
    apiKeyApi.updateAssignedMailboxes(7, [3, 5], 2);

    expect(requestPost).toHaveBeenCalledWith(
      '/admin/api-keys/7/allocation-reset',
      { group: 'priority' },
      {
        invalidatePrefixes: [
          '/admin/api-keys/7/allocation-stats',
          '/admin/api-keys/7/assigned-mailboxes',
        ],
      },
    );
    expect(requestPut).toHaveBeenCalledWith(
      '/admin/api-keys/7/assigned-mailboxes',
      { emailIds: [3, 5], groupId: 2 },
      {
        invalidatePrefixes: [
          '/admin/api-keys/7/allocation-stats',
          '/admin/api-keys/7/assigned-mailboxes',
        ],
      },
    );
  });
});
