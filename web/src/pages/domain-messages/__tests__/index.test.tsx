import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DomainMessagesPage from '..';
import { I18nProvider } from '../../../i18n';

vi.mock('../../../contracts/admin/domainMessages', () => ({
  domainMessagesContract: {
    getDomains: vi.fn(),
    getMailboxes: vi.fn(),
    getList: vi.fn(),
  },
}));

import { domainMessagesContract } from '../../../contracts/admin/domainMessages';

function ok<T>(data: T) {
  return Promise.resolve({ code: 200, data });
}

describe('DomainMessagesPage localization skeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(domainMessagesContract.getDomains).mockReturnValue(ok({ list: [] }) as never);
    vi.mocked(domainMessagesContract.getMailboxes).mockReturnValue(ok({ list: [] }) as never);
    vi.mocked(domainMessagesContract.getList).mockReturnValue(ok({ list: [] }) as never);
  });

  it('renders clean English top-level copy', async () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <DomainMessagesPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Domain messages' })).toBeInTheDocument();
    expect(screen.getByText('Filter by domain')).toBeInTheDocument();
    expect(screen.getByText('No domain messages yet')).toBeInTheDocument();
  });
});
