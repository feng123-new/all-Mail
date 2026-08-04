import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n';
import NotFoundPage, { type NotFoundSurface } from '.';

function renderNotFound(surface: NotFoundSurface) {
  return render(
    <I18nProvider initialLanguage="zh-CN" persist={false}>
      <MemoryRouter>
        <NotFoundPage surface={surface} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('NotFoundPage', () => {
  it.each([
    ['admin', '返回运行概况', '/dashboard'],
    ['portal', '返回收件箱', '/mail/inbox'],
    ['public', '返回登录', '/login'],
  ] as const)('renders a scoped %s recovery action', (surface, label, destination) => {
    renderNotFound(surface);
    expect(screen.getByText('页面不存在')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', destination);
  });
});
