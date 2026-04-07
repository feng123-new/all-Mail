import { App as AntApp, ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { type FC, lazy, type ReactElement, type ReactNode, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { authContract } from './contracts/shared/auth';
import { portalAccountContract } from './contracts/portal/account';
import { useAuthStore } from './stores/authStore';
import type { MailboxUser } from './stores/mailboxAuthStore';
import { useMailboxAuthStore } from './stores/mailboxAuthStore';
import { appTheme } from './theme';
import { isSuperAdmin } from './utils/auth';

// Pages (lazy loaded)
const LoginPage = lazy(() => import('./pages/login'));
const MainLayout = lazy(() => import('./layouts/MainLayout'));
const DashboardPage = lazy(() => import('./pages/dashboard'));
const EmailsPage = lazy(() => import('./pages/emails'));
const ApiKeysPage = lazy(() => import('./pages/api-keys'));
const ApiDocsPage = lazy(() => import('./pages/api-docs'));
const OperationLogsPage = lazy(() => import('./pages/operation-logs'));
const AdminsPage = lazy(() => import('./pages/admins'));
const SettingsPage = lazy(() => import('./pages/settings'));
const DomainsPage = lazy(() => import('./pages/domains'));
const DomainMailboxesPage = lazy(() => import('./pages/domain-mailboxes'));
const MailboxUsersPage = lazy(() => import('./pages/mailbox-users'));
const DomainMessagesPage = lazy(() => import('./pages/domain-messages'));
const ForwardingJobsPage = lazy(() => import('./pages/forwarding-jobs'));
const SendingConfigsPage = lazy(() => import('./pages/sending-configs'));
const MailboxLayout = lazy(() => import('./layouts/MailboxLayout'));
const MailPortalLoginPage = lazy(() => import('./pages/mail-portal/login'));
const MailPortalOverviewPage = lazy(() => import('./pages/mail-portal/overview'));
const MailPortalInboxPage = lazy(() => import('./pages/mail-portal/inbox'));
const MailPortalSettingsPage = lazy(() => import('./pages/mail-portal/settings'));

const PageFallback: FC = () => (
  <div className="page-fallback">
    <Spin />
  </div>
);

const AdminSessionBootstrap: FC = () => {
  const { isAuthenticated, admin, setAuth, clearAuth } = useAuthStore();
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void authContract.getMe()
      .then((response) => {
        if (cancelled) {
          return;
        }

        if (response.code === 200) {
          setAuth(response.data);
        } else {
          clearAuth();
        }

        setIsCheckingSession(false);
      })
      .catch(() => {
        if (!cancelled) {
          clearAuth();
          setIsCheckingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearAuth, setAuth]);

  if (isCheckingSession) {
    return <PageFallback />;
  }

  if (!isAuthenticated || !admin?.username) {
    return <Navigate to="/login" replace />;
  }

  return null;
};

const MailboxSessionBootstrap: FC = () => {
  const { isAuthenticated, mailboxUser, setAuth, clearAuth } = useMailboxAuthStore();
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void portalAccountContract.getSession<{ authenticated: boolean; mailboxUser?: MailboxUser }>()
      .then((response) => {
        if (cancelled) {
          return;
        }

        if (response.code !== 200) {
          clearAuth();
          return;
        }

        const payload = response.data;
        if (payload.mailboxUser) {
          setAuth(payload.mailboxUser);
        } else {
          clearAuth();
        }

        setIsCheckingSession(false);
      })
      .catch(() => {
        if (!cancelled) {
          clearAuth();
          setIsCheckingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearAuth, setAuth]);

  if (isCheckingSession) {
    return <PageFallback />;
  }

  if (!isAuthenticated || !mailboxUser?.username) {
    return <Navigate to="/mail/login" replace />;
  }

  return null;
};

// 路由守卫组件
const ProtectedRoute: FC<{ children: ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { isAuthenticated, admin } = useAuthStore();
  const needsSessionBootstrap = !isAuthenticated || !admin?.username;

  if (needsSessionBootstrap) {
    return <AdminSessionBootstrap />;
  }

  if (!isAuthenticated || !admin?.username) {
    return <Navigate to="/login" replace />;
  }

  if (admin.mustChangePassword && location.pathname !== '/settings') {
    return <Navigate to="/settings" replace />;
  }

  return <>{children}</>;
};

// 超级管理员路由守卫
const SuperAdminRoute: FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, admin } = useAuthStore();

  if (!isAuthenticated || !admin?.username) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin(admin?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

const MailboxProtectedRoute: FC<{ children: ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { isAuthenticated, mailboxUser } = useMailboxAuthStore();
  const needsSessionBootstrap = !isAuthenticated || !mailboxUser?.username;

  if (needsSessionBootstrap) {
    return <MailboxSessionBootstrap />;
  }

  if (!isAuthenticated || !mailboxUser?.username) {
    return <Navigate to="/mail/login" replace />;
  }

  if (mailboxUser.mustChangePassword && location.pathname !== '/mail/settings') {
    return <Navigate to="/mail/settings" replace />;
  }

  return <>{children}</>;
};

const App: FC = () => {
  const withSuspense = (element: ReactElement) => (
    <Suspense fallback={<PageFallback />}>
      {element}
    </Suspense>
  );

  return (
    <ConfigProvider
      locale={zhCN}
      theme={appTheme}
    >
      <AntApp>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <Routes>
            {/* 登录页 */}
            <Route path="/login" element={withSuspense(<LoginPage />)} />
            <Route path="/mail/login" element={withSuspense(<MailPortalLoginPage />)} />

            {/* 需要认证的页面 */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  {withSuspense(<MainLayout />)}
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={withSuspense(<DashboardPage />)} />
              <Route path="emails" element={withSuspense(<EmailsPage />)} />
              <Route path="api-keys" element={withSuspense(<ApiKeysPage />)} />
              <Route path="api-docs" element={withSuspense(<ApiDocsPage />)} />
              <Route path="operation-logs" element={withSuspense(<OperationLogsPage />)} />
              <Route path="domains" element={withSuspense(<DomainsPage />)} />
              <Route path="domain-mailboxes" element={withSuspense(<DomainMailboxesPage />)} />
              <Route path="mailbox-users" element={withSuspense(<MailboxUsersPage />)} />
              <Route path="domain-messages" element={withSuspense(<DomainMessagesPage />)} />
              <Route path="forwarding-jobs" element={withSuspense(<ForwardingJobsPage />)} />
              <Route path="sending-configs" element={withSuspense(<SendingConfigsPage />)} />
              <Route
                path="admins"
                element={
                  <SuperAdminRoute>
                    {withSuspense(<AdminsPage />)}
                  </SuperAdminRoute>
                }
              />
              <Route path="settings" element={withSuspense(<SettingsPage />)} />
            </Route>

            <Route
              path="/mail"
              element={
                <MailboxProtectedRoute>
                  {withSuspense(<MailboxLayout />)}
                </MailboxProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/mail/overview" replace />} />
              <Route path="overview" element={withSuspense(<MailPortalOverviewPage />)} />
              <Route path="inbox" element={withSuspense(<MailPortalInboxPage />)} />
              <Route path="settings" element={withSuspense(<MailPortalSettingsPage />)} />
            </Route>

            {/* 404 重定向 */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
