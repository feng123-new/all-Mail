import type { CSSProperties } from 'react';
import type { ThemeConfig } from 'antd';

export const shellPalette = {
  primary: '#1d4ed8',
  primarySoft: 'rgba(29, 78, 216, 0.10)',
  accent: '#0f766e',
  accentSoft: 'rgba(15, 118, 110, 0.10)',
  ink: '#0f172a',
  inkSoft: '#334155',
  muted: '#64748b',
  border: 'rgba(148, 163, 184, 0.18)',
  borderStrong: 'rgba(100, 116, 139, 0.26)',
  layoutBg: '#f3f6fa',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  sidebarBg: '#f6f8fb',
  sidebarSurface: '#fbfcfe',
  sidebarText: '#0f172a',
  sidebarMuted: 'rgba(71, 85, 105, 0.78)',
  success: '#15803d',
  warning: '#b45309',
  danger: '#dc2626',
};

export const fontFamilySans = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const shellRadii = {
  control: 10,
  card: 16,
  panel: 18,
  hero: 18,
};

export const shellMetrics = {
  adminSidebarWidth: 220,
  adminSidebarCollapsedWidth: 76,
  portalSidebarWidth: 224,
  headerHeight: 60,
  shellPadding: 24,
  contentMargin: 24,
  pageGap: 20,
  contentMaxWidth: 1520,
  portalContentMaxWidth: 1400,
  cardPadding: 22,
};

export const shellShadows = {
  subtle: '0 1px 2px rgba(15, 23, 42, 0.04)',
  medium: '0 8px 24px rgba(15, 23, 42, 0.06)',
  strong: '0 16px 40px rgba(15, 23, 42, 0.08)',
  brand: '0 10px 24px rgba(15, 23, 42, 0.08)',
};

export const shellMotion = {
  standard: '0.2s ease',
};

export const shellGradients = {
  surface: shellPalette.surface,
  pageHeader: shellPalette.layoutBg,
  authBackdrop: shellPalette.layoutBg,
};

export const contentCardStyle: CSSProperties = {
  background: shellPalette.surface,
  border: `1px solid ${shellPalette.border}`,
  borderRadius: shellRadii.card,
  boxShadow: shellShadows.subtle,
};

export const insetCardStyle: CSSProperties = {
  background: shellPalette.surfaceMuted,
  border: `1px solid ${shellPalette.border}`,
  borderRadius: shellRadii.card,
  boxShadow: 'none',
};

export const appTheme: ThemeConfig = {
  cssVar: { key: 'allmail' },
  token: {
    colorPrimary: shellPalette.primary,
    colorInfo: shellPalette.primary,
    colorSuccess: shellPalette.success,
    colorWarning: shellPalette.warning,
    colorError: shellPalette.danger,
    colorTextBase: shellPalette.ink,
    colorTextSecondary: shellPalette.inkSoft,
    colorTextDescription: shellPalette.muted,
    colorBorder: shellPalette.borderStrong,
    colorBorderSecondary: shellPalette.border,
    colorBgLayout: shellPalette.layoutBg,
    colorBgContainer: shellPalette.surface,
    colorBgElevated: shellPalette.surface,
    borderRadius: shellRadii.control,
    borderRadiusLG: shellRadii.card,
    fontFamily: fontFamilySans,
    boxShadowSecondary: shellShadows.medium,
    controlHeight: 38,
    controlHeightLG: 42,
  },
  components: {
    Layout: {
      bodyBg: shellPalette.layoutBg,
      headerBg: shellPalette.surface,
      siderBg: shellPalette.sidebarBg,
      triggerBg: shellPalette.sidebarBg,
    },
    Menu: {
      itemHeight: 42,
      itemMarginInline: 8,
      itemBorderRadius: shellRadii.control,
      itemBg: 'transparent',
      itemColor: shellPalette.inkSoft,
      itemHoverBg: 'rgba(15, 23, 42, 0.035)',
      itemSelectedBg: shellPalette.primarySoft,
      itemSelectedColor: shellPalette.primary,
      subMenuItemBg: 'transparent',
    },
    Card: {
      headerBg: 'transparent',
    },
    Button: {
      borderRadius: shellRadii.control,
      primaryShadow: 'none',
    },
    Table: {
      headerBg: '#f8fafc',
      headerSplitColor: shellPalette.border,
      rowHoverBg: hexToRgba(shellPalette.primary, 0.04),
    },
    Input: {
      activeBorderColor: shellPalette.primary,
      hoverBorderColor: shellPalette.primary,
    },
    Select: {
      optionSelectedBg: shellPalette.primarySoft,
    },
    Tag: {
      defaultBg: shellPalette.surfaceMuted,
    },
    Segmented: {
      itemSelectedBg: shellPalette.surface,
    },
  },
};

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    return hex;
  }

  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
