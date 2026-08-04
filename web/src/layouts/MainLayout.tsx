import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MenuOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Button,
  Dropdown,
  Layout,
  Menu,
  type MenuProps,
  Tag,
  Typography,
} from 'antd';
import { type FC, useCallback, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { ADMIN_NAVIGATION_GROUPS, getAdminRouteMeta } from '../app/navigation';
import { authApi } from '../api';
import {
  ControlBoundaryContext,
  LanguageToggle,
  MailFlowContext,
  PageSurface,
  WorkspaceFrame,
} from '../components';
import { APP_NAME, APP_SHORT_NAME } from '../constants/product';
import { useResponsiveShell } from '../hooks/useResponsiveShell';
import { useI18n } from '../i18n';
import { mainLayoutI18n } from '../i18n/catalog/shell';
import { useAuthStore } from '../stores/authStore';
import { shellMetrics, shellPalette } from '../theme';
import { isSuperAdmin } from '../utils/auth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const MainLayout: FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isNarrow = useResponsiveShell();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { admin, clearAuth } = useAuthStore();

  const mustChangePassword = Boolean(admin?.mustChangePassword);
  const hasSuperAdminPermission = isSuperAdmin(admin?.role);
  const displayName = admin?.username?.trim() || t(mainLayoutI18n.admin);
  const avatarText = displayName.charAt(0).toUpperCase();
  const routeMeta = getAdminRouteMeta(location.pathname);
  const desktopCollapsed = !isNarrow && collapsed;
  const sidebarWidth = desktopCollapsed
    ? shellMetrics.adminSidebarCollapsedWidth
    : shellMetrics.adminSidebarWidth;

  const menuItems: MenuProps['items'] = useMemo(
    () => ADMIN_NAVIGATION_GROUPS.map((group) => ({
      type: 'group' as const,
      key: `group-${group.key}`,
      label: t(group.label),
      children: group.items
        .filter((item) => !item.superAdmin || hasSuperAdminPermission)
        .map((item) => ({
          key: item.key,
          icon: item.icon,
          disabled: mustChangePassword && item.key !== '/settings',
          label: <Link to={item.key}>{t(item.label)}</Link>,
        })),
    })),
    [hasSuperAdminPermission, mustChangePassword, t],
  );

  const handleLogout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Authentication state is cleared locally even if the best-effort request fails.
    }
    clearAuth();
    navigate('/login');
  }, [clearAuth, navigate]);

  const userMenuItems: MenuProps['items'] = useMemo(() => [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: t(mainLayoutI18n.profile),
      onClick: () => navigate('/settings'),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t(mainLayoutI18n.logout),
      danger: true,
      onClick: handleLogout,
    },
  ], [handleLogout, navigate, t]);

  return (
    <Layout className="app-shell">
      {isNarrow && mobileNavOpen ? (
        <button
          type="button"
          className="app-shell__overlay"
          aria-label={t(mainLayoutI18n.closeNavigation)}
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <Sider
        trigger={null}
        collapsible
        collapsed={desktopCollapsed}
        collapsedWidth={shellMetrics.adminSidebarCollapsedWidth}
        width={shellMetrics.adminSidebarWidth}
        theme="light"
        className={`app-shell__sider${mobileNavOpen ? ' is-open' : ''}`}
      >
        <div className="app-shell__brand">
          <div className="app-shell__brand-mark" aria-hidden="true">{APP_SHORT_NAME}</div>
          {!desktopCollapsed ? (
            <div className="app-shell__brand-copy">
              <Text strong className="app-shell__brand-name">{APP_NAME}</Text>
              <Text className="app-shell__brand-subtitle">{t(mainLayoutI18n.controlPlane)}</Text>
            </div>
          ) : null}
        </div>

        <div className="app-shell__navigation">
          {!desktopCollapsed ? (
            <Text className="app-shell__navigation-label">{t(mainLayoutI18n.navigation)}</Text>
          ) : null}
          <Menu
            theme="light"
            mode="inline"
            selectedKeys={[routeMeta.key]}
            items={menuItems}
            inlineCollapsed={desktopCollapsed}
            onClick={() => {
              if (isNarrow) setMobileNavOpen(false);
            }}
            className="app-shell__menu"
          />
        </div>
      </Sider>

      <Layout
        className="app-shell__main"
        style={{ marginLeft: isNarrow ? 0 : sidebarWidth }}
      >
        <Header className="app-shell__header">
          <div className="app-shell__header-start">
            <Button
              type="text"
              className="app-shell__menu-trigger"
              aria-label={isNarrow
                ? t(mainLayoutI18n.openNavigation)
                : t(collapsed ? mainLayoutI18n.expandSidebar : mainLayoutI18n.collapseSidebar)}
              onClick={() => {
                if (isNarrow) {
                  setMobileNavOpen(true);
                } else {
                  setCollapsed((value) => !value);
                }
              }}
              icon={isNarrow
                ? <MenuOutlined />
                : collapsed
                  ? <MenuUnfoldOutlined />
                  : <MenuFoldOutlined />}
            />
            <div className="app-shell__route-context">
              <Text className="app-shell__route-title">{t(routeMeta.title)}</Text>
              <Text className="app-shell__route-subtitle">{t(routeMeta.subtitle)}</Text>
            </div>
          </div>

          <div className="app-shell__header-actions">
            <LanguageToggle />
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <button type="button" className="app-shell__user-trigger">
                <Avatar size="small" style={{ background: shellPalette.primary }}>{avatarText}</Avatar>
                <span className="app-shell__user-copy">
                  <span className="app-shell__user-name">{displayName}</span>
                  <span className="app-shell__user-role">
                    {hasSuperAdminPermission ? t(mainLayoutI18n.superAdmin) : t(mainLayoutI18n.admin)}
                  </span>
                </span>
                {mustChangePassword ? (
                  <Tag color="warning" className="app-shell__security-tag">
                    {t(mainLayoutI18n.passwordResetRequired)}
                  </Tag>
                ) : null}
              </button>
            </Dropdown>
          </div>
        </Header>

        <Content className="app-shell__content">
          <PageSurface>
            <WorkspaceFrame kind={routeMeta.workspace}>
              {routeMeta.mailFlowSurface ? (
                <MailFlowContext surface={routeMeta.mailFlowSurface} />
              ) : null}
              {routeMeta.controlBoundarySurface ? (
                <ControlBoundaryContext surface={routeMeta.controlBoundarySurface} />
              ) : null}
              <Outlet />
            </WorkspaceFrame>
          </PageSurface>
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
