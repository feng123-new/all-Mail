import type { FC, ReactNode } from 'react';
import { Breadcrumb, Typography } from 'antd';
import { Link } from 'react-router';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumb?: Array<{ title: ReactNode; path?: string }>;
  extra?: ReactNode;
  eyebrow?: ReactNode | null;
}

const PageHeader: FC<PageHeaderProps> = ({
  title,
  subtitle,
  breadcrumb,
  extra,
  eyebrow = null,
}) => (
  <header className="page-header">
    <div className="page-header__content">
      {breadcrumb && breadcrumb.length > 0 ? (
        <Breadcrumb
          className="page-header__breadcrumb"
          items={breadcrumb.map((item) => ({
            title: item.path ? <Link to={item.path}>{item.title}</Link> : item.title,
          }))}
        />
      ) : null}
      {eyebrow ? <Text className="page-header__eyebrow">{eyebrow}</Text> : null}
      <Title level={2} className="page-header__title">{title}</Title>
      {subtitle ? <Text className="page-header__subtitle">{subtitle}</Text> : null}
    </div>
    {extra ? <div className="page-header__extra">{extra}</div> : null}
  </header>
);

export default PageHeader;
