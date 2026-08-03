import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n';
import PortalWorkspaceContext from '../PortalWorkspaceContext';

describe('PortalWorkspaceContext', () => {
  it('makes the inbox the primary action-oriented workspace', () => {
    render(
      <I18nProvider initialLanguage="zh-CN" persist={false}>
        <PortalWorkspaceContext surface="inbox" />
      </I18nProvider>,
    );

    expect(screen.getByText('收件箱优先工作区')).toBeInTheDocument();
    expect(screen.getByText(/未读、验证码与需要回复的邮件/)).toBeInTheDocument();
    expect(screen.getByText('未读优先').closest('.status-badge')).toHaveAttribute('data-tone', 'info');
    expect(screen.getByText('验证码与快捷动作').closest('.status-badge')).toHaveAttribute('data-tone', 'success');
  });

  it('keeps overview focused on summary rather than message handling', () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <PortalWorkspaceContext surface="overview" />
      </I18nProvider>,
    );

    expect(screen.getByText('Resources and action summary')).toBeInTheDocument();
    expect(screen.getByText(/Open the inbox when a message needs direct action/)).toBeInTheDocument();
    expect(screen.getByText('Sending readiness')).toBeInTheDocument();
    expect(screen.getByText('Forwarding state')).toBeInTheDocument();
  });

  it('keeps first-password restrictions visible in settings', () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <PortalWorkspaceContext surface="settings" />
      </I18nProvider>,
    );

    expect(screen.getByText('Account and mailbox settings')).toBeInTheDocument();
    expect(screen.getByText(/Other workspaces stay restricted/)).toBeInTheDocument();
    expect(screen.getByText('Password and 2FA')).toBeInTheDocument();
    expect(screen.getByText('Forwarding policy')).toBeInTheDocument();
  });
});
