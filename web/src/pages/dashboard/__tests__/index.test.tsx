import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from '..';
import { I18nProvider } from '../../../i18n';

vi.mock('../../../contracts/admin/dashboard', () => ({
  dashboardContract: {
    getStats: vi.fn(),
    getApiTrend: vi.fn(),
    getLogs: vi.fn(),
    getEmailStats: vi.fn(),
    getErrorEmails: vi.fn(),
  },
}));

vi.mock('../../../components/charts', () => ({
  SimpleLineChart: ({ data }: { data: Array<{ count: number }> }) => <div data-testid="mock-line-chart">{data.length}</div>,
}));

import { dashboardContract } from '../../../contracts/admin/dashboard';

describe('DashboardPage proof scenario', () => {
  it('renders degraded-data proof mode without live contract calls', async () => {
    render(
      <MemoryRouter
        initialEntries={['/dashboard?proof=degraded-data']}
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('本地证据场景 · 降级数据')).toBeInTheDocument();
    expect(screen.getByText(/5 类服务商正在承载当前邮箱池|3 类服务商正在承载当前邮箱池/)).toBeInTheDocument();
    expect(screen.getByText('outlook-hot-01@example.com')).toBeInTheDocument();
    expect(await screen.findByTestId('mock-line-chart')).toHaveTextContent('7');
    expect(dashboardContract.getStats).not.toHaveBeenCalled();
    expect(dashboardContract.getApiTrend).not.toHaveBeenCalled();
    expect(dashboardContract.getLogs).not.toHaveBeenCalled();
    expect(dashboardContract.getEmailStats).not.toHaveBeenCalled();
    expect(dashboardContract.getErrorEmails).not.toHaveBeenCalled();
  });

  it('renders clean English copy in proof mode', async () => {
    render(
      <I18nProvider initialLanguage="en-US" persist={false}>
        <MemoryRouter
          initialEntries={['/dashboard?proof=degraded-data']}
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <DashboardPage />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Daily posture')).toBeInTheDocument();
    expect(screen.getByText('Calls in last 14 days')).toBeInTheDocument();
    expect(screen.getByText('Provider breakdown')).toBeInTheDocument();
    expect(screen.queryByText('控制台概览')).not.toBeInTheDocument();
  });
});
