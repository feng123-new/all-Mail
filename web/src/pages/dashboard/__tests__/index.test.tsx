import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from '..';

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

    expect(await screen.findByText('Proof scenario · degraded data')).toBeInTheDocument();
    expect(screen.getByText(/5 类 Provider 正在承载当前邮箱池|3 类 Provider 正在承载当前邮箱池/)).toBeInTheDocument();
    expect(screen.getByText('outlook-hot-01@example.com')).toBeInTheDocument();
    expect(await screen.findByTestId('mock-line-chart')).toHaveTextContent('7');
    expect(dashboardContract.getStats).not.toHaveBeenCalled();
    expect(dashboardContract.getApiTrend).not.toHaveBeenCalled();
    expect(dashboardContract.getLogs).not.toHaveBeenCalled();
    expect(dashboardContract.getEmailStats).not.toHaveBeenCalled();
    expect(dashboardContract.getErrorEmails).not.toHaveBeenCalled();
  });
});
