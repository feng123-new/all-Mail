import {
  AppstoreOutlined,
  InboxOutlined,
  LogoutOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Button,
  Dropdown,
  Layout,
  Menu,
  type MenuProps,
  Typography,
} from 'antd';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { mailboxPortalApi } from '../api';
import { LanguageToggle, PageSurface } from '../components';
import { APP_NAME, APP_SHORT_NAME } from '../constants/product';
import { useResponsiveShell } from '../hooks/useResponsiveShell';
import { useI18n } from '../i18n';
import { mailboxLayoutI18n } from '../i18n/catalog/shell';
import { useMailboxAuthStore } from '../stores/mailboxAuthStore';
import { shellMetrics, shellPalette } from '../theme';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const portalNavigation: Array<{
  key: string;
  icon: ReactNode;
  label: typeof mailboxLayoutI18n.overview;
}> = [
  { key: '/mail/overview', icon: <AppstoreOutlined />, label: mailboxLayoutI18n.overview },
  { key: '/mail/inbox', icon: <InboxOutlined />, label: mailboxLayoutI18n.inbox },
  { key: '/mail/settings', icon: <SettingOutlined />, label: mailboxLayoutI18n.settings },
];

const portalRouteMeta = {
  '/mail/overview': mailboxLayoutI18n.overview,
  '/mail/inbox': mailboxLayoutI18n.inbox,
  '/mail/settings': mailboxLayoutI18n.settings,
} as const;

const MailboxLayout: React.FC = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isNarrow = useResponsiveShell();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { mailboxUser, clearAuth } = useMailboxAuthStore();

  const assignedMailboxCount = mailboxUser?.mailboxIds?.length || 0;
  const mustChangePassword = Boolean(mailboxUser?.mustChangePassword);
  const activeMeta = portalRouteMeta[location.pathname as keyof typeof portalRouteMeta]
    || mailboxLayoutI18n.mailboxPortal;

  const menuItems: MenuProps['items'] = useMemo(
    () => portalNavigation.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: <Link to={item.key}>{t(item.label)}</Link>,
      disabled: mustChangePassword && item.key !== '/mail/settings',
    })),
    [mustChangePassword, t],
  );

  const handleLogout = useCallback(async () => {
    try {
      await mailboxPortalApi.logout();
    } catch {
      // The local session is still cleared when the best-effort logout request fails.
    }
    clearAuth();
    navigate('/mail/login');
  }, [clearAuth, navigate]);

  const userMenuItems: MenuProps['items'] = useMemo(() => [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t(mailboxLayoutI18n.signOut),
      onClick: handleLogout,
      danger: true,
    },
  ], [handleLogout, t]);

  return (
    <Layout className="app-shell app-shell--portal">
      {isNarrow && mobileNavOpen ? (
        <button
          type="button"
          className="app-shell__overlay"
          aria-label={t(mailboxLayoutI18n.closeNavigation)}
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <Sider
        theme="light"
        width={shellMetrics.portalSidebarWidth}
        className={`app-shell__sider app-shell__sider--portal${mobileNavOpen ? ' is-open' : ''}`}
      >
        <div className="app-shell__brand app-shell__brand--portal">
          <div className="app-shell__brand-mark" aria-hidden="true">{APP_SHORT_NAME}</div>
          <div className="app-shell__brand-copy">
            <Text strong className="app-shell__brand-name">{APP_NAME}</Text>
            <Text className="app-shell__brand-subtitle">{t(mailboxLayoutI18n.mailboxWorkspace)}</Text>
          </div>
        </div>

        <div className="portal-shell__identity">
          <Text className="portal-shell__identity-label">{t(mailboxLayoutI18n.mailboxAccess)}</Text>
          <Text strong className="portal-shell__identity-value">
            {t(mailboxLayoutI18n.accessibleMailboxCount, { count: assignedMailboxCount })}
          </Text>
          <Text className="portal-shell__identity-state">
            {mustChangePassword
              ? t(mailboxLayoutI18n.passwordUpdateRequired)
              : t(mailboxLayoutI18n.securityHealthy)}
          </Text>
        </div>

        <div className="app-shell__navigation">
          <Text className="app-shell__navigation-label">{t(mailboxLayoutI18n.workspace)}</Text>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            theme="light"
            className="app-shell__menu"
            onClick={() => {
              if (isNarrow) setMobileNavOpen(false);
            }}
          />
        </div>

        {mustChangePassword ? (
          <div className="portal-shell__security-notice">
            <div className="portal-shell__security-title">
              <SafetyCertificateOutlined style={{ color: shellPalette.warning }} />
              <Text strong>{t(mailboxLayoutI18n.updatePasswordFirst)}</Text>
            </div>
            <Text className="portal-shell__security-copy">{t(mailboxLayoutI18n.updatePasswordHint)}</Text>
          </div>
        ) : null}
      </Sider>

      <Layout
        className="app-shell__main"
        style={{ marginLeft: isNarrow ? 0 : shellMetrics.portalSidebarWidth }}
      >
        <Header className="app-shell__header">
          <div className="app-shell__header-start">
            {isNarrow ? (
              <Button
                type="text"
                className="app-shell__menu-trigger"
                aria-label={t(mailboxLayoutI18n.openNavigation)}
                icon={<MenuOutlined />}
                onClick={() => setMobileNavOpen(true)}
              />
            ) : null}
            <div className="app-shell__route-context">
              <Text className="app-shell__route-title">{t(activeMeta)}</Text>
              <Text className="app-shell__route-subtitle">{t(mailboxLayoutI18n.mailboxPortal)}</Text>
            </div>
          </div>

          <div className="app-shell__header-actions">
            <LanguageToggle />
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <button type="button" className="app-shell__user-trigger">
                <Avatar size="small" style={{ background: shellPalette.primary }}>
                  {(mailboxUser?.username || 'M').slice(0, 1).toUpperCase()}
                </Avatar>
                <span className="app-shell__user-copy">
                  <span className="app-shell__user-name">
                    {mailboxUser?.username || t(mailboxLayoutI18n.mailboxUser)}
                  </span>
                  <span className="app-shell__user-role">
                    {t(mailboxLayoutI18n.accessibleMailboxCount, { count: assignedMailboxCount })}
                  </span>
                </span>
              </button>
            </Dropdown>
          </div>
        </Header>

        <Content className="app-shell__content">
          <PageSurface maxWidth={shellMetrics.portalContentMaxWidth}>
            <Outlet />
          </PageSurface>
        </Content>
      </Layout>
    </Layout>
  );
};

export default MailboxLayout;
