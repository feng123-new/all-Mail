import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import MainLayout from '../layouts/MainLayout';
import { I18nProvider } from '../i18n';
import { useAuthStore } from '../stores/authStore';

function renderRoute(path: string) {
  useAuthStore.setState({
    admin: { id: 1, username: 'root', role: 'SUPER_ADMIN' },
    isAuthenticated: true,
  });

  return render(
    <I18nProvider initialLanguage="zh-CN" persist={false}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<MainLayout />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('administrator control-boundary routes', () => {
  it('uses distinct API-key, API-documentation, and audit context', async () => {
    const apiKeys = renderRoute('/api-keys');
    expect(await screen.findByText('自动化访问边界')).toBeInTheDocument();
    expect(screen.getByText('显式权限')).toBeInTheDocument();
    apiKeys.unmount();

    const apiDocs = renderRoute('/api-docs');
    expect(await screen.findByText('稳定调用契约')).toBeInTheDocument();
    expect(screen.getByText('错误语义')).toBeInTheDocument();
    apiDocs.unmount();

    renderRoute('/operation-logs');
    expect(await screen.findByText('可追溯审计证据')).toBeInTheDocument();
    expect(screen.getByText('敏感值不入日志')).toBeInTheDocument();
  });

  it('keeps administrator security separate from account and runtime settings', async () => {
    const admins = renderRoute('/admins');
    expect(await screen.findByText('管理员安全边界')).toBeInTheDocument();
    expect(screen.getByText('会话撤销')).toBeInTheDocument();
    admins.unmount();

    renderRoute('/settings');
    expect(await screen.findByText('系统安全设置')).toBeInTheDocument();
    expect(screen.getByText('敏感操作确认')).toBeInTheDocument();
  });

  it('does not add control-boundary chrome to unrelated resource routes', async () => {
    renderRoute('/domains');

    expect(await screen.findByText(/查看域名收发状态/)).toBeInTheDocument();
    expect(screen.queryByText('自动化访问边界')).not.toBeInTheDocument();
    expect(screen.queryByText('系统安全设置')).not.toBeInTheDocument();
  });
});
