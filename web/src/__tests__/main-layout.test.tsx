import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import MainLayout from '../layouts/MainLayout';
import { I18nProvider } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import type { AppLanguage } from '../i18n/messages';

function renderMainLayout(language: AppLanguage = 'zh-CN', path = '/dashboard') {
  return render(
    <I18nProvider initialLanguage={language} persist={false}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<MainLayout />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('MainLayout navigation', () => {
  it('hides the admins entry for non-super-admin users', async () => {
    useAuthStore.setState({
      admin: { id: 2, username: 'staff', role: 'ADMIN' },
      isAuthenticated: true,
    });

    renderMainLayout();

    expect(await screen.findByText('all-Mail')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: '管理员' })).not.toBeInTheDocument();
    });
  });

  it('shows grouped navigation and the admins entry for super-admin users', async () => {
    useAuthStore.setState({
      admin: { id: 1, username: 'root', role: 'SUPER_ADMIN' },
      isAuthenticated: true,
    });

    renderMainLayout();

    expect(await screen.findByRole('link', { name: '管理员' })).toBeInTheDocument();
    expect(await screen.findByText('转发任务')).toBeInTheDocument();
    expect(screen.getByText('邮箱资源')).toBeInTheDocument();
    expect(screen.getByText('邮件流')).toBeInTheDocument();
    expect(screen.getByText('自动化与审计')).toBeInTheDocument();

    const automationGroup = screen.getByText('自动化与审计').closest('.ant-menu-item-group');
    expect(automationGroup).not.toBeNull();
    const automationLinks = within(automationGroup as HTMLElement).getAllByRole('link');
    expect(automationLinks.map((link) => link.textContent)).toEqual(['访问密钥', 'API 文档', '审计日志']);
    expect(automationLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/api-keys',
      '/api-docs',
      '/operation-logs',
    ]);
  });

  it('renders route context from the active navigation item', async () => {
    useAuthStore.setState({
      admin: { id: 1, username: 'root', role: 'SUPER_ADMIN' },
      isAuthenticated: true,
    });

    renderMainLayout('zh-CN', '/forwarding-jobs');

    expect((await screen.findAllByText('转发任务')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/失败原因和下一次重试时间/)).toBeInTheDocument();
  });

  it('attaches the correct workspace contract to resource and mail-flow routes', async () => {
    useAuthStore.setState({
      admin: { id: 1, username: 'root', role: 'SUPER_ADMIN' },
      isAuthenticated: true,
    });

    const resourceView = renderMainLayout('zh-CN', '/domains');
    expect(await screen.findByText(/查看域名收发状态/)).toBeInTheDocument();
    expect(resourceView.container.querySelector('[data-workspace="resource"]')).toBeInTheDocument();
    expect(screen.queryByText('转发执行链路')).not.toBeInTheDocument();
    resourceView.unmount();

    const flowView = renderMainLayout('zh-CN', '/forwarding-jobs');
    expect(await screen.findByText(/失败原因和下一次重试时间/)).toBeInTheDocument();
    expect(flowView.container.querySelector('[data-workspace="flow"]')).toBeInTheDocument();
    expect(screen.getByText('转发执行链路')).toBeInTheDocument();
  });

  it('uses distinct inbound, forwarding, and outbound context on mail-flow routes', async () => {
    useAuthStore.setState({
      admin: { id: 1, username: 'root', role: 'SUPER_ADMIN' },
      isAuthenticated: true,
    });

    const inboundView = renderMainLayout('zh-CN', '/domain-messages');
    expect(await screen.findByText('入站邮件链路')).toBeInTheDocument();
    expect(screen.getByText('已存储')).toBeInTheDocument();
    inboundView.unmount();

    const forwardingView = renderMainLayout('zh-CN', '/forwarding-jobs');
    expect(await screen.findByText('转发执行链路')).toBeInTheDocument();
    expect(screen.getByText('已跳过')).toBeInTheDocument();
    forwardingView.unmount();

    renderMainLayout('zh-CN', '/sending-configs');
    expect(await screen.findByText('发信准备链路')).toBeInTheDocument();
    expect(screen.getByText('已就绪')).toBeInTheDocument();
  });

  it('renders English navigation when the language is switched', async () => {
    useAuthStore.setState({
      admin: { id: 1, username: 'root', role: 'SUPER_ADMIN' },
      isAuthenticated: true,
    });

    renderMainLayout('en-US');

    expect((await screen.findAllByText('Overview')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Navigation')).toBeInTheDocument();
    expect(await screen.findByText('Mail resources')).toBeInTheDocument();
    expect(await screen.findByText('Admins')).toBeInTheDocument();
  });

  it('keeps shared layout copy clean when switching from Chinese to English', async () => {
    useAuthStore.setState({
      admin: { id: 1, username: 'root', role: 'SUPER_ADMIN' },
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

  it('opens the responsive navigation control on a narrow viewport', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    useAuthStore.setState({
      admin: { id: 1, username: 'root', role: 'SUPER_ADMIN' },
      isAuthenticated: true,
    });

    try {
      renderMainLayout();
      window.dispatchEvent(new Event('resize'));

      const trigger = await screen.findByRole('button', { name: '打开导航' });
      await userEvent.click(trigger);
      expect(await screen.findByRole('button', { name: '关闭导航' })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      window.dispatchEvent(new Event('resize'));
    }
  });
});
