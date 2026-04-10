import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '..';
import { I18nProvider } from '../../../i18n';
import { useAuthStore } from '../../../stores/authStore';

vi.mock('../../../contracts/shared/auth', () => ({
  authContract: {
    getTwoFactorStatus: vi.fn(),
    changePassword: vi.fn(),
    setupTwoFactor: vi.fn(),
    enableTwoFactor: vi.fn(),
    disableTwoFactor: vi.fn(),
  },
}));

import { authContract } from '../../../contracts/shared/auth';

function ok<T>(data: T) {
  return Promise.resolve({ code: 200, data });
}

describe('SettingsPage API usage localization', () => {
  beforeEach(() => {
    useAuthStore.setState({
      admin: {
        id: 1,
        username: 'admin',
        role: 'SUPER_ADMIN',
        twoFactorEnabled: false,
        mustChangePassword: false,
      },
      isAuthenticated: true,
    });

    vi.clearAllMocks();
    vi.mocked(authContract.getTwoFactorStatus).mockReturnValue(
      ok({ enabled: false, pending: false, legacyEnv: false }) as never,
    );
  });

  it('renders the API usage instructions in English', async () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MemoryRouter
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <SettingsPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByText('External API usage')).toBeInTheDocument();
    expect(screen.getByText('# Pass the API key via a header')).toBeInTheDocument();
    expect(screen.getByText('# Query-parameter API keys are no longer supported')).toBeInTheDocument();
    expect(screen.getByText(/Use a header instead: curl -H/)).toBeInTheDocument();
    expect(screen.queryByText('# 通过 Header 传递访问密钥')).not.toBeInTheDocument();
    expect(screen.queryByText('# 不再支持 Query 参数传递访问密钥')).not.toBeInTheDocument();
  });
});
