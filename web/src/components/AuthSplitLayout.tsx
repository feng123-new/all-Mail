import type { FC, ReactNode } from 'react';
import { Card, Space, Tag, Typography } from 'antd';
import { shellPalette } from '../theme';
import {
  authBackdropStyle,
  authFeatureCardStyle,
  authFormPanelStyle,
  authIntroPanelStyle,
} from '../styles/common';

const { Paragraph, Text, Title } = Typography;

interface AuthTag {
  color: string;
  label: string;
}

interface AuthFeature {
  description: string;
  icon: ReactNode;
  title: string;
}

interface AuthSplitLayoutProps {
  children: ReactNode;
  features: AuthFeature[];
  footer?: ReactNode;
  formDescription: string;
  formTitle: string;
  notice?: ReactNode;
  tags: AuthTag[];
  title: string;
  subtitle: string;
}

const AuthSplitLayout: FC<AuthSplitLayoutProps> = ({
  children,
  features,
  footer,
  formDescription,
  formTitle,
  notice,
  tags,
  title,
  subtitle,
}) => {
  return (
    <div style={authBackdropStyle}>
        <div className="auth-split-grid">
          <div className="auth-split-intro" style={authIntroPanelStyle}>
            <Space orientation="vertical" size={24} style={{ width: '100%' }}>
              <Space wrap size={8}>
                {tags.map((tag) => (
                  <Tag
                    key={tag.label}
                    variant="filled"
                    style={{
                      marginInlineEnd: 0,
                      borderRadius: 999,
                      paddingInline: 10,
                      paddingBlock: 2,
                      background: shellPalette.sidebarSurface,
                      color: shellPalette.inkSoft,
                      border: `1px solid ${shellPalette.border}`,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {tag.label}
                  </Tag>
                ))}
              </Space>

              <div>
                <Text style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: shellPalette.muted, marginBottom: 10 }}>
                  Operator access
                </Text>
               <Title level={1} style={{ margin: 0, fontSize: 38, lineHeight: 1.02, letterSpacing: -1 }}>{title}</Title>
               <Paragraph style={{ margin: '12px 0 0', color: shellPalette.inkSoft, fontSize: 15, maxWidth: 560, lineHeight: 1.75 }}>
                  {subtitle}
                </Paragraph>
              </div>

            <div className="auth-split-feature-grid">
              {features.map((item) => (
                <div key={item.title} style={authFeatureCardStyle}>
                  <Space align="start" size={14} style={{ width: '100%' }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        color: shellPalette.primary,
                        background: shellPalette.primarySoft,
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Text strong style={{ color: shellPalette.ink, fontSize: 14 }}>{item.title}</Text>
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ lineHeight: 1.65 }}>{item.description}</Text>
                      </div>
                    </div>
                  </Space>
                </div>
              ))}
            </div>

            {notice ? (
              <div style={{ border: `1px solid ${shellPalette.border}`, borderRadius: 16, padding: '13px 14px', background: shellPalette.surfaceMuted }}>
                <Text type="secondary">{notice}</Text>
              </div>
            ) : null}
          </Space>
        </div>

        <Card
          className="auth-split-form-panel"
          variant="borderless"
          style={authFormPanelStyle}
          styles={{ body: { padding: 30 } }}
        >
          <Space orientation="vertical" size={20} style={{ width: '100%' }}>
            <div>
              <Text style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: shellPalette.muted, marginBottom: 8 }}>
                Access point
              </Text>
              <Title level={3} style={{ marginBottom: 8, fontSize: 28, lineHeight: 1.12 }}>{formTitle}</Title>
              <Text type="secondary" style={{ lineHeight: 1.7, color: shellPalette.inkSoft }}>{formDescription}</Text>
            </div>
            {children}
            {footer ? <div style={{ paddingTop: 4 }}>{footer}</div> : null}
          </Space>
        </Card>
      </div>
    </div>
  );
};

export default AuthSplitLayout;
