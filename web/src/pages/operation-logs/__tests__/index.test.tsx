import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperationLogsPage from '..';
import { I18nProvider } from '../../../i18n';

vi.mock('../../../contracts/admin/logs', () => ({
  logsContract: {
    getList: vi.fn(),
    delete: vi.fn(),
    batchDelete: vi.fn(),
  },
}));

import { logsContract } from '../../../contracts/admin/logs';

function ok<T>(data: T) {
  return Promise.resolve({ code: 200, data });
}

describe('OperationLogsPage localization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(logsContract.getList).mockReturnValue(ok({
      list: [
        {
          id: 1,
          action: 'external_allocate_mailbox',
          apiKeyName: 'allocator',
          email: 'ops@example.com',
          requestIp: '127.0.0.1',
          requestId: 'req-1',
          responseCode: 200,
          responseTimeMs: 12,
          createdAt: '2026-04-08T00:00:00.000Z',
        },
      ],
      total: 1,
    }) as never);
  });

  it('renders clean English copy for list controls and action labels', async () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MemoryRouter
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <OperationLogsPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByText('allocator')).toBeInTheDocument();
    expect(screen.getByText('Filter by action type')).toBeInTheDocument();
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('Allocate external mailbox')).toBeInTheDocument();
    expect(screen.queryByText('获取日志失败')).not.toBeInTheDocument();
    expect(screen.queryByText('时间')).not.toBeInTheDocument();
  });
});
