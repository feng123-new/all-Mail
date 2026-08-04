import { describe, expect, it } from 'vitest';
import {
  EMPTY_DASHBOARD_STATS,
  EMPTY_EMAIL_STATS,
  resolveDashboardStats,
  resolveEmailStats,
} from './model';
import type { EmailStats, Stats } from './shared';

describe('dashboard model fallbacks', () => {
  it('uses stable empty models while data is loading', () => {
    expect(resolveEmailStats(null)).toBe(EMPTY_EMAIL_STATS);
    expect(resolveDashboardStats(null)).toBe(EMPTY_DASHBOARD_STATS);
    expect(EMPTY_EMAIL_STATS.providers).toEqual({});
    expect(EMPTY_DASHBOARD_STATS.domainMail.inboundMessages).toBe(0);
  });

  it('preserves loaded server models without cloning them', () => {
    const emailStats: EmailStats = {
      total: 3,
      active: 2,
      error: 1,
      providers: { gmail: 3 },
    };
    const stats: Stats = {
      apiKeys: { total: 1, active: 1, totalUsage: 5, todayActive: 1 },
      domainMail: {
        domains: 1,
        activeDomains: 1,
        mailboxes: 2,
        activeMailboxes: 2,
        inboundMessages: 10,
        outboundMessages: 4,
      },
    };

    expect(resolveEmailStats(emailStats)).toBe(emailStats);
    expect(resolveDashboardStats(stats)).toBe(stats);
  });
});
