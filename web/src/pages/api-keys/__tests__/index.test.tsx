import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApiKeysPage from '..';
import { I18nProvider } from '../../../i18n';

vi.mock('../../../contracts/admin/apiKeys', () => ({
  apiKeysContract: {
    getList: vi.fn(),
    getGroups: vi.fn(),
    getDomains: vi.fn(),
    getEmails: vi.fn(),
  },
}));

import { apiKeysContract } from '../../../contracts/admin/apiKeys';

function ok<T>(data: T) {
  return Promise.resolve({ code: 200, data });
}

describe('ApiKeysPage localization skeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiKeysContract.getList).mockReturnValue(ok({
      list: [{
        id: 1,
        name: 'automation-key',
        keyPrefix: 'ak_test',
        rateLimit: 60,
        status: 'ACTIVE',
        expiresAt: null,
        lastUsedAt: null,
        usageCount: 0,
        createdAt: '2026-08-04T00:00:00.000Z',
        createdByName: 'admin',
      }],
      total: 1,
    }) as never);
    vi.mocked(apiKeysContract.getGroups).mockReturnValue(ok([]) as never);
    vi.mocked(apiKeysContract.getDomains).mockReturnValue(ok({ list: [], total: 0 }) as never);
    vi.mocked(apiKeysContract.getEmails).mockReturnValue(ok({ list: [], total: 0 }) as never);
  });

  it('renders clean English top-level copy', async () => {
    const view = render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MemoryRouter>
          <ApiKeysPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'API keys and resource scope' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create API key/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(view.container.querySelector('.ant-table-tbody-virtual')).not.toBeInTheDocument();
    expect(view.container.querySelector('.ant-table-tbody-virtual-holder')).not.toBeInTheDocument();
  });

  it('offers only permissions accepted by the API-key backend contract', async () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MemoryRouter>
          <ApiKeysPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Create API key/ }));

    expect((await screen.findAllByText('Create API key')).length).toBeGreaterThan(1);
    expect(screen.queryByRole('checkbox', { name: /Verify external-secret reveal access/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Reveal external mailbox secret under control/ })).not.toBeInTheDocument();
  });
});
