import { Suspense, lazy, type FC, type ReactElement, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider, App as AntApp, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useAuthStore } from './stores/authStore';
import { useMailboxAuthStore } from './stores/mailboxAuthStore';
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
const SendingConfigsPage = lazy(() => import('./pages/sending-configs'));
const MailboxLayout = lazy(() => import('./layouts/MailboxLayout'));
const MailPortalLoginPage = lazy(() => import('./pages/mail-portal/login'));
const MailPortalOverviewPage = lazy(() => import('./pages/mail-portal/overview'));
const MailPortalInboxPage = lazy(() => import('./pages/mail-portal/inbox'));
const MailPortalSettingsPage = lazy(() => import('./pages/mail-portal/settings'));

const PageFallback: FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240 }}>
    <Spin />
  </div>
);

// 路由守卫组件
const ProtectedRoute: FC<{ children: ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { isAuthenticated, token, admin } = useAuthStore();

  if (!isAuthenticated || !token || !admin?.username) {
    return <Navigate to="/login" replace />;
  }

  if (admin.mustChangePassword && location.pathname !== '/settings') {
    return <Navigate to="/settings" replace />;
  }

  return <>{children}</>;
};

// 超级管理员路由守卫
const SuperAdminRoute: FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, token, admin } = useAuthStore();

  if (!isAuthenticated || !token || !admin?.username) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin(admin?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

const MailboxProtectedRoute: FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, token, mailboxUser } = useMailboxAuthStore();

  if (!isAuthenticated || !token || !mailboxUser?.username) {
    return <Navigate to="/mail/login" replace />;
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
      theme={{
        cssVar: {},
        token: {
          colorPrimary: '#5865f2',
          colorInfo: '#5865f2',
          colorSuccess: '#2f9e77',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorBgLayout: '#f4f7fb',
          borderRadius: 14,
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
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
