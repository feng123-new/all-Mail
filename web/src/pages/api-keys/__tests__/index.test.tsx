import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    vi.mocked(apiKeysContract.getList).mockReturnValue(ok({ list: [], total: 0 }) as never);
    vi.mocked(apiKeysContract.getGroups).mockReturnValue(ok([]) as never);
    vi.mocked(apiKeysContract.getDomains).mockReturnValue(ok({ list: [], total: 0 }) as never);
    vi.mocked(apiKeysContract.getEmails).mockReturnValue(ok({ list: [], total: 0 }) as never);
  });

  it('renders clean English top-level copy', async () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <ApiKeysPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'API keys and resource scope' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create API key/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
  });
});
