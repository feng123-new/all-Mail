import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n';
import MailFlowContext from '../MailFlowContext';
import { getMailFlowStateTone } from '../MailFlowStatusBadge';

describe('MailFlowContext', () => {
  it('maps runtime states to restrained semantic tones', () => {
    expect(getMailFlowStateTone('PENDING')).toBe('warning');
    expect(getMailFlowStateTone('RUNNING')).toBe('info');
    expect(getMailFlowStateTone('SENT')).toBe('success');
    expect(getMailFlowStateTone('FAILED')).toBe('danger');
    expect(getMailFlowStateTone('SKIPPED')).toBe('default');
  });

  it('explains forwarding states with direct operational language', () => {
    render(
      <I18nProvider initialLanguage="zh-CN" persist={false}>
        <MailFlowContext surface="forwarding" />
      </I18nProvider>,
    );

    expect(screen.getByText('转发执行链路')).toBeInTheDocument();
    expect(screen.getByText(/重试次数、下次尝试时间和最后错误/)).toBeInTheDocument();
    expect(screen.getByText('待处理').closest('.status-badge')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('处理中').closest('.status-badge')).toHaveAttribute('data-tone', 'info');
    expect(screen.getByText('已发送').closest('.status-badge')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByText('失败').closest('.status-badge')).toHaveAttribute('data-tone', 'danger');
  });

  it('renders route-specific English context for inbound and outbound workspaces', () => {
    const inbound = render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MailFlowContext surface="inbound" />
      </I18nProvider>,
    );

    expect(screen.getByText('Inbound mail flow')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('Stored')).toBeInTheDocument();
    inbound.unmount();

    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MailFlowContext surface="outbound" />
      </I18nProvider>,
    );

    expect(screen.getByText('Outbound readiness')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
