import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminsPage from '..';
import { I18nProvider } from '../../../i18n';
import { useAuthStore } from '../../../stores/authStore';

vi.mock('../../../contracts/admin/admins', () => ({
  adminsContract: {
    getList: vi.fn(),
  },
}));

import { adminsContract } from '../../../contracts/admin/admins';

function ok<T>(data: T) {
  return Promise.resolve({ code: 200, data });
}

describe('AdminsPage localization skeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      admin: { id: 1, username: 'root', role: 'SUPER_ADMIN', mustChangePassword: false },
      isAuthenticated: true,
    });
    vi.mocked(adminsContract.getList).mockReturnValue(ok({ list: [], total: 0 }) as never);
  });

  it('renders clean English top-level copy', async () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <AdminsPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Admin management' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add admin/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Username' })).toBeInTheDocument();
  });
});
