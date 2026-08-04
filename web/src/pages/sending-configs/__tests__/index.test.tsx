import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SendingConfigsPage from '..';
import { I18nProvider } from '../../../i18n';

vi.mock('../../../contracts/admin/sending', () => ({
  sendingContract: {
    getConfigs: vi.fn(),
    getMessages: vi.fn(),
    getDomains: vi.fn(),
    getMailboxes: vi.fn(),
  },
}));

import { sendingContract } from '../../../contracts/admin/sending';

function ok<T>(data: T) {
  return Promise.resolve({ code: 200, data });
}

describe('SendingConfigsPage localization skeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendingContract.getConfigs).mockReturnValue(ok({ list: [] }) as never);
    vi.mocked(sendingContract.getMessages).mockReturnValue(ok({ list: [] }) as never);
    vi.mocked(sendingContract.getDomains).mockReturnValue(ok({ list: [] }) as never);
    vi.mocked(sendingContract.getMailboxes).mockReturnValue(ok({ list: [] }) as never);
  });

  it('renders clean English top-level copy', async () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MemoryRouter>
          <SendingConfigsPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Sending configs and history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send test mail/ })).toBeInTheDocument();
    expect(screen.getByText('No sending configs yet')).toBeInTheDocument();
  });
});
