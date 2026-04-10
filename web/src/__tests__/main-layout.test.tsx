import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import MainLayout from '../layouts/MainLayout';
import { I18nProvider } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import type { AppLanguage } from '../i18n/messages';

function renderMainLayout(language: AppLanguage = 'zh-CN') {
  return render(
    <I18nProvider initialLanguage={language} persist={false}>
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
    </I18nProvider>
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
      expect(screen.queryByRole('link', { name: '管理员' })).not.toBeInTheDocument();
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

    expect(await screen.findByRole('link', { name: '管理员' })).toBeInTheDocument();
    expect(await screen.findByText('转发任务')).toBeInTheDocument();
  });

  it('renders English navigation when the language is switched', async () => {
    useAuthStore.setState({
      admin: {
        id: 1,
        username: 'root',
        role: 'SUPER_ADMIN',
      },
      isAuthenticated: true,
    });

    renderMainLayout('en-US');

    expect(await screen.findByText('Overview')).toBeInTheDocument();
    expect(await screen.findByText('Navigation')).toBeInTheDocument();
    expect(await screen.findByText('Admins')).toBeInTheDocument();
  });

  it('keeps shared layout copy clean when switching from Chinese to English', async () => {
    useAuthStore.setState({
      admin: {
        id: 1,
        username: 'root',
        role: 'SUPER_ADMIN',
      },
      isAuthenticated: true,
    });

    renderMainLayout('zh-CN');

    expect(await screen.findByText('导航')).toBeInTheDocument();
    await userEvent.click(await screen.findByText('English'));

    await waitFor(() => {
      expect(screen.getByText('Navigation')).toBeInTheDocument();
      expect(screen.getByText('Super admin')).toBeInTheDocument();
    });
    expect(screen.queryByText('超级管理员')).not.toBeInTheDocument();
  });
});
