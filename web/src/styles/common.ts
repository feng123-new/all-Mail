import type { CSSProperties } from 'react';
import {
  hexToRgba,
  shellGradients,
  shellMetrics,
  shellMotion,
  shellPalette,
  shellRadii,
  shellShadows,
} from '../theme';

export const fullWidthStyle: CSSProperties = { width: '100%' };
export const noMarginStyle: CSSProperties = { margin: 0 };
export const noMarginBottomStyle: CSSProperties = { marginBottom: 0 };
export const marginRight8Style: CSSProperties = { marginRight: 8 };
export const marginTop4Style: CSSProperties = { marginTop: 4 };
export const marginTop6Style: CSSProperties = { marginTop: 6 };
export const marginTop8Style: CSSProperties = { marginTop: 8 };
export const marginBottom8Style: CSSProperties = { marginBottom: 8 };
export const marginBottom12Style: CSSProperties = { marginBottom: 12 };
export const marginBottom16Style: CSSProperties = { marginBottom: 16 };
export const marginBottom24Style: CSSProperties = { marginBottom: 24 };
export const maxWidth400Style: CSSProperties = { maxWidth: 400 };
export const displayBlockMarginBottom4Style: CSSProperties = { display: 'block', marginBottom: 4 };
export const displayBlockMarginBottom6Style: CSSProperties = { display: 'block', marginBottom: 6 };
export const displayBlockMarginBottom8Style: CSSProperties = { display: 'block', marginBottom: 8 };
export const displayBlockMarginBottom12Style: CSSProperties = { display: 'block', marginBottom: 12 };
export const centeredTextStyle: CSSProperties = { textAlign: 'center' };
export const centeredPadding40Style: CSSProperties = { textAlign: 'center', padding: 40 };
export const centeredPadding48Style: CSSProperties = { textAlign: 'center', padding: 48 };
export const centeredPadding24Style: CSSProperties = { textAlign: 'center', padding: 24 };
export const centeredPadding56Style: CSSProperties = { textAlign: 'center', padding: 56 };
export const centeredPadding56MinHeight260Style: CSSProperties = { textAlign: 'center', padding: 56, minHeight: 260 };
export const centeredPadding56MinHeight300Style: CSSProperties = { textAlign: 'center', padding: 56, minHeight: 300 };
export const centeredFlexMinHeight260Style: CSSProperties = { minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' };
export const gridGap16Style: CSSProperties = { display: 'grid', gap: 16 };
export const flexBetweenFullWidthStyle: CSSProperties = { justifyContent: 'space-between', width: '100%' };
export const flexBetweenWrapStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 };
export const orderedListStyle: CSSProperties = { margin: 0, paddingLeft: 20 };
export const listItemMarginBottom8Style: CSSProperties = { marginBottom: 8 };
export const preWrapBreakWordStyle: CSSProperties = { whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
export const wordBreakBreakAllStyle: CSSProperties = { wordBreak: 'break-all' };
export const clickableStyle: CSSProperties = { cursor: 'pointer' };
export const maxHeight450AutoStyle: CSSProperties = { maxHeight: 450, overflow: 'auto' };
export const width140Style: CSSProperties = { width: 140 };
export const width120Style: CSSProperties = { width: 120 };
export const width150Style: CSSProperties = { width: 150 };
export const width160Style: CSSProperties = { width: 160 };
export const width170Style: CSSProperties = { width: 170 };
export const width180Style: CSSProperties = { width: 180 };
export const width200Style: CSSProperties = { width: 200 };
export const width220Style: CSSProperties = { width: 220 };
export const width260Style: CSSProperties = { width: 260 };
export const widthFullMarginTop8Style: CSSProperties = { width: '100%', marginTop: 8 };
export const secondaryMutedTextStyle: CSSProperties = { color: '#999' };
export const secondaryMutedOffsetTextStyle: CSSProperties = { marginLeft: 16, color: '#888' };
export const fontSize12Style: CSSProperties = { fontSize: 12 };
export const fontSize11Style: CSSProperties = { fontSize: 11 };
export const fontSize16Style: CSSProperties = { fontSize: 16 };
export const marginLeft4Style: CSSProperties = { marginLeft: 4 };
export const codeBlockStyle: CSSProperties = { whiteSpace: 'pre-wrap' };
export const codeBlockCompactStyle: CSSProperties = { whiteSpace: 'pre-wrap', fontSize: 12 };
export const neutralCodePanelStyle: CSSProperties = { background: '#f5f5f5', padding: 16, borderRadius: 8 };
export const cardBgMutedStyle: CSSProperties = { background: '#fafafa' };
export const cardBgSuccessStyle: CSSProperties = { background: '#f6ffed' };
export const cardBgErrorStyle: CSSProperties = { background: '#fff2f0' };
export const stickyTop24Style: CSSProperties = { position: 'sticky', top: 24 };
export const successTextStyle: CSSProperties = { color: '#389e0d' };
export const errorTextStyle: CSSProperties = { color: '#cf1322' };

const sidebarDivider = `1px solid ${shellPalette.border}`;
const sidebarPanelBorder = `1px solid ${shellPalette.border}`;

export const shellLayoutStyle: CSSProperties = {
  minHeight: '100vh',
  background: shellPalette.layoutBg,
};

export const fixedSidebarStyle: CSSProperties = {
  overflow: 'auto',
  height: '100vh',
  position: 'fixed',
  left: 0,
  top: 0,
  bottom: 0,
  background: shellPalette.sidebarBg,
  borderRight: sidebarDivider,
  boxShadow: 'none',
};

export const floatingSidebarStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: shellPalette.sidebarBg,
  borderRight: sidebarDivider,
  boxShadow: 'none',
};

export const shellHeaderStyle: CSSProperties = {
  background: 'rgba(243, 246, 250, 0.86)',
  borderBottom: `1px solid ${shellPalette.border}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: `0 ${shellMetrics.shellPadding}px`,
  height: shellMetrics.headerHeight,
  lineHeight: `${shellMetrics.headerHeight}px`,
  backdropFilter: 'blur(10px)',
};

export const contentFrameStyle: CSSProperties = {
  padding: `${shellMetrics.contentMargin - 2}px ${shellMetrics.shellPadding}px ${shellMetrics.shellPadding + 10}px`,
};

export const pageHeaderCardStyle: CSSProperties = {
  marginBottom: 6,
  paddingBottom: 0,
  display: 'grid',
  gap: 6,
};

export const pageHeaderTopStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
};

export const pageHeaderEyebrowStyle: CSSProperties = {
  display: 'block',
  color: shellPalette.muted,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
  marginBottom: 6,
};

export const statCardStyle: CSSProperties = {
  height: '100%',
  borderRadius: shellRadii.card,
  border: `1px solid ${shellPalette.border}`,
  boxShadow: shellShadows.subtle,
  background: shellPalette.surface,
};

export const authBackdropStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: shellMetrics.contentMargin + 8,
  background: shellGradients.authBackdrop,
};

export const authIntroPanelStyle: CSSProperties = {
  padding: '12px 6px 12px 0',
};

export const authFormPanelStyle: CSSProperties = {
  borderRadius: shellRadii.panel,
  border: `1px solid ${shellPalette.border}`,
  boxShadow: shellShadows.medium,
  background: shellPalette.surface,
};

export const authFeatureCardStyle: CSSProperties = {
  borderRadius: shellRadii.card,
  padding: '12px 0',
  background: 'transparent',
  borderBottom: `1px solid ${shellPalette.border}`,
};

export const sidebarPanelStyle: CSSProperties = {
  background: shellPalette.sidebarSurface,
  border: sidebarPanelBorder,
  borderRadius: shellRadii.card,
  padding: 14,
  boxShadow: shellShadows.subtle,
};

export const translucentSidebarPanelStyle: CSSProperties = {
  background: shellPalette.surfaceMuted,
  border: sidebarPanelBorder,
  borderRadius: shellRadii.card,
  padding: 14,
};

export const shellUserTriggerStyle: CSSProperties = {
  cursor: 'pointer',
  transition: `opacity ${shellMotion.standard}`,
  borderRadius: 14,
  padding: '8px 10px',
  border: `1px solid ${shellPalette.border}`,
  background: shellPalette.surface,
};

export const shellHeaderContextStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  lineHeight: 1.2,
};

export const shellHeaderLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: shellPalette.muted,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
};

export const shellHeaderMetaStyle: CSSProperties = {
  fontSize: 13,
  color: shellPalette.inkSoft,
  fontWeight: 600,
};

export function createBrandMarkStyle(options: {
  size: number;
  radius: number;
  fontSize?: number;
}): CSSProperties {
  const { size, radius, fontSize = Math.max(16, Math.floor(size * 0.46)) } = options;

  return {
    width: size,
    height: size,
    borderRadius: radius,
    background: shellPalette.primary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 700,
    fontSize,
    boxShadow: shellShadows.brand,
    border: `1px solid ${hexToRgba(shellPalette.primary, 0.16)}`,
    flexShrink: 0,
  };
}

export function createStatIconStyle(color: string): CSSProperties {
  return {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: hexToRgba(color, 0.08),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 17,
    color,
    border: `1px solid ${hexToRgba(color, 0.12)}`,
  };
}
