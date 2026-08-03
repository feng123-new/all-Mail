import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n';
import ControlBoundaryContext from '../ControlBoundaryContext';

describe('ControlBoundaryContext', () => {
  it('explains API-key scope without exposing a reusable secret value', () => {
    render(
      <I18nProvider initialLanguage="zh-CN" persist={false}>
        <ControlBoundaryContext surface="api-keys" />
      </I18nProvider>,
    );

    expect(screen.getByText('自动化访问边界')).toBeInTheDocument();
    expect(screen.getByText('显式权限').closest('.status-badge')).toHaveAttribute('data-tone', 'info');
    expect(screen.getByText('资源范围')).toBeInTheDocument();
    expect(screen.getByText('速率与使用记录').closest('.status-badge')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByText(/密钥值只在创建时展示一次/)).toBeInTheDocument();
    expect(screen.queryByText(/sk-/i)).not.toBeInTheDocument();
  });

  it('keeps audit evidence focused on actor, request ID, response, and latency', () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <ControlBoundaryContext surface="audit" />
      </I18nProvider>,
    );

    expect(screen.getByText('Traceable audit evidence')).toBeInTheDocument();
    expect(screen.getByText('Actor')).toBeInTheDocument();
    expect(screen.getByText('Request ID').closest('.status-badge')).toHaveAttribute('data-tone', 'info');
    expect(screen.getByText('Response & latency')).toBeInTheDocument();
    expect(screen.getByText('Secrets excluded')).toBeInTheDocument();
  });

  it('distinguishes administrator controls from personal system settings', () => {
    const admins = render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <ControlBoundaryContext surface="admins" />
      </I18nProvider>,
    );

    expect(screen.getByText('Administrator security boundary')).toBeInTheDocument();
    expect(screen.getByText('Role boundary')).toBeInTheDocument();
    expect(screen.getByText('Session revocation')).toBeInTheDocument();
    admins.unmount();

    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <ControlBoundaryContext surface="settings" />
      </I18nProvider>,
    );

    expect(screen.getByText('System security settings')).toBeInTheDocument();
    expect(screen.getByText('Password security')).toBeInTheDocument();
    expect(screen.getByText('Sensitive-action confirmation')).toBeInTheDocument();
  });
});
