import type { FC, ReactNode } from 'react';
import { Card, Tag, Typography } from 'antd';
import { APP_SHORT_NAME } from '../constants/product';
import { authSplitLayoutI18n } from '../i18n/catalog/shell';
import { useI18n } from '../i18n';
import LanguageToggle from './LanguageToggle';
import './AuthSplitLayout.css';

const { Paragraph, Text, Title } = Typography;

interface AuthTag {
  color: string;
  key: string;
  label: ReactNode;
}

interface AuthFeature {
  description: ReactNode;
  icon: ReactNode;
  key: string;
  title: ReactNode;
}

interface AuthSplitLayoutProps {
  children: ReactNode;
  features: AuthFeature[];
  footer?: ReactNode;
  formDescription: ReactNode;
  formTitle: ReactNode;
  notice?: ReactNode;
  tags: AuthTag[];
  title: ReactNode;
  subtitle: ReactNode;
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
  const { t } = useI18n();

  return (
    <main className="auth-entry">
      <header className="auth-entry__topbar">
        <div className="auth-entry__brand">
          <span className="auth-entry__brand-mark" aria-hidden="true">{APP_SHORT_NAME}</span>
          <Text className="auth-entry__brand-name">{title}</Text>
        </div>
        <LanguageToggle />
      </header>

      <div className="auth-entry__grid">
        <Card
          className="auth-entry__form-panel"
          variant="borderless"
          styles={{ body: { padding: 30 } }}
        >
          <div className="auth-entry__form-heading">
            <Text className="auth-entry__eyebrow">{t(authSplitLayoutI18n.accessPoint)}</Text>
            <Title level={2} className="auth-entry__form-title">{formTitle}</Title>
            <Text className="auth-entry__form-description">{formDescription}</Text>
          </div>
          {children}
          {footer ? <div className="auth-entry__footer">{footer}</div> : null}
        </Card>

        <aside className="auth-entry__context" aria-label={t(authSplitLayoutI18n.operatorAccess)}>
          <div>
            <div className="auth-entry__tags">
              {tags.map((tag) => (
                <Tag key={tag.key} color={tag.color} className="auth-entry__tag">
                  {tag.label}
                </Tag>
              ))}
            </div>
            <Title level={1} className="auth-entry__title">{title}</Title>
            <Paragraph className="auth-entry__subtitle">{subtitle}</Paragraph>
          </div>

          <div className="auth-entry__features">
            {features.map((item) => (
              <div key={item.key} className="auth-entry__feature">
                <span className="auth-entry__feature-icon" aria-hidden="true">{item.icon}</span>
                <span className="auth-entry__feature-copy">
                  <span className="auth-entry__feature-title">{item.title}</span>
                  <span className="auth-entry__feature-description">{item.description}</span>
                </span>
              </div>
            ))}
          </div>

          {notice ? <div className="auth-entry__notice">{notice}</div> : null}
        </aside>
      </div>
    </main>
  );
};

export default AuthSplitLayout;
