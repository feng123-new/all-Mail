import {
  type ComponentType,
  type FC,
  lazy,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router';
import type { SimpleLineChartProps } from '../../components/charts';
import { dashboardContract } from '../../contracts/admin/dashboard';
import DashboardOverview from './DashboardOverview';
import './DashboardOverview.mobile.css';
import { resolveDashboardStats, resolveEmailStats } from './model';
import {
  type ApiTrendItem,
  DASHBOARD_PROOF_FIXTURE,
  DASHBOARD_PROOF_MODE,
  type EmailStats,
  type ErrorEmailItem,
  isLocalProofHost,
  type LogItem,
  type Stats,
  type TrendWindow,
} from './shared';

const LineChart = lazy(async () => {
  const mod = await import('../../components/charts');
  return {
    default: mod.SimpleLineChart as ComponentType<SimpleLineChartProps>,
  };
});

const DashboardPage: FC = () => {
  const [searchParams] = useSearchParams();
  const [coreLoading, setCoreLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [chartsReady, setChartsReady] = useState(false);
  const [chartsInView, setChartsInView] = useState(false);
  const [trendDays, setTrendDays] = useState<TrendWindow>(14);
  const [stats, setStats] = useState<Stats | null>(null);
  const [emailStats, setEmailStats] = useState<EmailStats | null>(null);
  const [apiTrend, setApiTrend] = useState<ApiTrendItem[]>([]);
  const [recentLogs, setRecentLogs] = useState<LogItem[]>([]);
  const [errorEmails, setErrorEmails] = useState<ErrorEmailItem[]>([]);
  const chartsSectionRef = useRef<HTMLDivElement | null>(null);
  const proofScenario = isLocalProofHost()
    ? searchParams.get('proof')?.trim() || ''
    : '';
  const isDegradedProof = proofScenario === DASHBOARD_PROOF_MODE;

  useEffect(() => {
    if (isDegradedProof) {
      setStats(DASHBOARD_PROOF_FIXTURE.stats);
      setEmailStats(DASHBOARD_PROOF_FIXTURE.emailStats);
      setRecentLogs(DASHBOARD_PROOF_FIXTURE.recentLogs);
      setErrorEmails(DASHBOARD_PROOF_FIXTURE.errorEmails);
      setApiTrend(DASHBOARD_PROOF_FIXTURE.apiTrend);
      setCoreLoading(false);
      setLogsLoading(false);
      setTrendLoading(false);
      setChartsReady(true);
      setChartsInView(true);
      return;
    }

    let disposed = false;
    let idleId: number | null = null;
    let timerId: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const loadCore = async () => {
      try {
        const [statsRes, emailStatsRes, logsRes, errorEmailsRes] = await Promise.all([
          dashboardContract.getStats<Stats>(),
          dashboardContract.getEmailStats<EmailStats>(),
          dashboardContract.getLogs<LogItem>({ page: 1, pageSize: 6 }),
          dashboardContract.getErrorEmails<ErrorEmailItem>({
            page: 1,
            pageSize: 5,
            status: 'ERROR',
          }),
        ]);

        if (disposed) return;

        if (statsRes.code === 200) setStats(statsRes.data);
        if (emailStatsRes.code === 200) setEmailStats(emailStatsRes.data);
        if (logsRes.code === 200) setRecentLogs(logsRes.data.list || []);
        if (errorEmailsRes.code === 200) {
          setErrorEmails(errorEmailsRes.data.list || []);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard core data:', error);
      } finally {
        if (!disposed) {
          setCoreLoading(false);
          setLogsLoading(false);
        }
      }
    };

    void loadCore();

    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleId = idleWindow.requestIdleCallback(
        () => {
          if (!disposed) setChartsReady(true);
        },
        { timeout: 1200 },
      );
    } else {
      timerId = window.setTimeout(() => {
        if (!disposed) setChartsReady(true);
      }, 350);
    }

    return () => {
      disposed = true;
      if (
        idleId !== null
        && typeof idleWindow.cancelIdleCallback === 'function'
      ) {
        idleWindow.cancelIdleCallback(idleId);
      }
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [isDegradedProof]);

  useEffect(() => {
    if (isDegradedProof) {
      setChartsInView(true);
      return;
    }

    const target = chartsSectionRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      setChartsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setChartsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [isDegradedProof]);

  useEffect(() => {
    if (isDegradedProof) {
      setTrendLoading(false);
      return;
    }
    if (!chartsReady || !chartsInView) return;

    let cancelled = false;
    setTrendLoading(true);

    const loadTrend = async () => {
      try {
        const trendRes = await dashboardContract.getApiTrend<ApiTrendItem>(trendDays);
        if (!cancelled && trendRes.code === 200) {
          setApiTrend(trendRes.data);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard trend:', error);
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    };

    void loadTrend();
    return () => {
      cancelled = true;
    };
  }, [chartsInView, chartsReady, isDegradedProof, trendDays]);

  return (
    <DashboardOverview
      proofVisible={isDegradedProof}
      statsData={resolveDashboardStats(stats)}
      emailStats={resolveEmailStats(emailStats)}
      apiTrend={apiTrend}
      recentLogs={recentLogs}
      errorEmails={errorEmails}
      coreLoading={coreLoading}
      trendLoading={trendLoading}
      logsLoading={logsLoading}
      trendDays={trendDays}
      onTrendDaysChange={setTrendDays}
      chartsReady={chartsReady}
      chartsInView={chartsInView}
      chartsSectionRef={chartsSectionRef}
      LineChart={LineChart}
    />
  );
};

export default DashboardPage;
