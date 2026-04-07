import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import MainLayout from '../layouts/MainLayout';
import { useAuthStore } from '../stores/authStore';

function renderMainLayout() {
  return render(
    <MemoryRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
      initialEntries={['/dashboard']}
    >
      <Routes>
        <Route path="*" element={<MainLayout />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('MainLayout navigation', () => {
  it('hides the admins entry for non-super-admin users', async () => {
    useAuthStore.setState({
      admin: {
        id: 2,
        username: 'staff',
        role: 'ADMIN',
      },
      isAuthenticated: true,
    });

    renderMainLayout();

    expect(await screen.findByText('all-Mail')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('管理员')).not.toBeInTheDocument();
    });
  });

  it('shows the admins entry for super-admin users', async () => {
    useAuthStore.setState({
      admin: {
        id: 1,
        username: 'root',
        role: 'SUPER_ADMIN',
      },
      isAuthenticated: true,
    });

    renderMainLayout();

    expect(await screen.findByText('管理员')).toBeInTheDocument();
    expect(await screen.findByText('转发任务')).toBeInTheDocument();
  });
});
