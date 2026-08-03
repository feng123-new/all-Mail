import type { ThemeConfig } from 'antd';
import type { CSSProperties } from 'react';

export const shellPalette = {
  primary: '#1d4ed8',
  primaryHover: '#1e40af',
  primarySoft: 'rgba(29, 78, 216, 0.09)',
  accent: '#0f766e',
  accentSoft: 'rgba(15, 118, 110, 0.09)',
  ink: '#111827',
  inkSoft: '#374151',
  muted: '#6b7280',
  mutedSoft: '#94a3b8',
  border: 'rgba(148, 163, 184, 0.20)',
  borderStrong: 'rgba(100, 116, 139, 0.30)',
  layoutBg: '#f4f6f8',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  surfaceStrong: '#eef2f7',
  sidebarBg: '#f8fafc',
  sidebarSurface: '#ffffff',
  sidebarText: '#111827',
  sidebarMuted: '#64748b',
  success: '#15803d',
  warning: '#b45309',
  danger: '#b91c1c',
  info: '#1d4ed8',
};

export const fontFamilySans = "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const shellRadii = {
  control: 8,
  card: 12,
  panel: 14,
  hero: 14,
  pill: 999,
};

export const shellMetrics = {
  adminSidebarWidth: 248,
  adminSidebarCollapsedWidth: 76,
  portalSidebarWidth: 248,
  headerHeight: 64,
  shellPadding: 24,
  contentMargin: 24,
  pageGap: 20,
  contentMaxWidth: 1520,
  portalContentMaxWidth: 1360,
  cardPadding: 20,
  twoFactorQrSize: 180,
};

export const shellShadows = {
  subtle: '0 1px 2px rgba(15, 23, 42, 0.035)',
  medium: '0 10px 28px rgba(15, 23, 42, 0.07)',
  strong: '0 18px 48px rgba(15, 23, 42, 0.10)',
  brand: '0 8px 18px rgba(29, 78, 216, 0.18)',
};

export const shellMotion = {
  fast: '0.14s ease',
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
  hashed: true,
  token: {
    colorPrimary: shellPalette.primary,
    colorInfo: shellPalette.info,
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
    colorFillAlter: shellPalette.surfaceMuted,
    borderRadius: shellRadii.control,
    borderRadiusLG: shellRadii.card,
    borderRadiusSM: 6,
    fontFamily: fontFamilySans,
    boxShadowSecondary: shellShadows.medium,
    controlHeight: 38,
    controlHeightLG: 42,
    controlHeightSM: 30,
    lineHeight: 1.55,
  },
  components: {
    Layout: {
      bodyBg: shellPalette.layoutBg,
      headerBg: shellPalette.surface,
      siderBg: shellPalette.sidebarBg,
      triggerBg: shellPalette.sidebarBg,
    },
    Menu: {
      itemHeight: 40,
      itemMarginInline: 8,
      itemMarginBlock: 2,
      itemBorderRadius: shellRadii.control,
      itemBg: 'transparent',
      itemColor: shellPalette.inkSoft,
      itemHoverBg: 'rgba(15, 23, 42, 0.04)',
      itemHoverColor: shellPalette.ink,
      itemSelectedBg: shellPalette.primarySoft,
      itemSelectedColor: shellPalette.primary,
      groupTitleColor: shellPalette.muted,
      groupTitleFontSize: 11,
      subMenuItemBg: 'transparent',
    },
    Card: {
      headerBg: 'transparent',
      headerFontSize: 15,
      paddingLG: shellMetrics.cardPadding,
    },
    Button: {
      borderRadius: shellRadii.control,
      primaryShadow: 'none',
      fontWeight: 600,
    },
    Table: {
      headerBg: shellPalette.surfaceMuted,
      headerColor: shellPalette.inkSoft,
      headerSplitColor: shellPalette.border,
      rowHoverBg: hexToRgba(shellPalette.primary, 0.035),
      borderColor: shellPalette.border,
      cellPaddingBlock: 12,
      cellPaddingInline: 14,
    },
    Input: {
      activeBorderColor: shellPalette.primary,
      hoverBorderColor: shellPalette.primary,
      activeShadow: `0 0 0 2px ${hexToRgba(shellPalette.primary, 0.10)}`,
    },
    InputNumber: {
      activeBorderColor: shellPalette.primary,
      hoverBorderColor: shellPalette.primary,
      activeShadow: `0 0 0 2px ${hexToRgba(shellPalette.primary, 0.10)}`,
    },
    Select: {
      optionSelectedBg: shellPalette.primarySoft,
      activeBorderColor: shellPalette.primary,
      hoverBorderColor: shellPalette.primary,
    },
    Tag: {
      defaultBg: shellPalette.surfaceMuted,
      borderRadiusSM: 6,
    },
    Segmented: {
      itemSelectedBg: shellPalette.surface,
      trackBg: shellPalette.surfaceStrong,
    },
    Modal: {
      borderRadiusLG: shellRadii.panel,
    },
    Drawer: {
      colorBgElevated: shellPalette.surface,
    },
    Tabs: {
      itemSelectedColor: shellPalette.primary,
      inkBarColor: shellPalette.primary,
    },
    Tooltip: {
      borderRadius: shellRadii.control,
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
