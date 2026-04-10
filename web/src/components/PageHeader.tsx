import type { FC, ReactNode } from 'react';
import { Breadcrumb, Space, Typography } from 'antd';
import { Link } from 'react-router-dom';
import {
  pageHeaderCardStyle,
  pageHeaderEyebrowStyle,
} from '../styles/common';
import { shellPalette } from '../theme';
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
}) => {
  return (
        <div style={pageHeaderCardStyle}>
            {breadcrumb && breadcrumb.length > 0 && (
                <Breadcrumb
                    items={breadcrumb.map((item) => ({
                        title: item.path ? <Link to={item.path}>{item.title}</Link> : item.title,
                    }))}
                    style={{ marginBottom: 6 }}
                />
            )}
            <div className="page-header__top">
                <div style={{ maxWidth: 720 }}>
                     {eyebrow ? (
                          <Text className="page-header__eyebrow" style={pageHeaderEyebrowStyle}>
                             {eyebrow}
                          </Text>
                      ) : null}
                      <Title level={2} style={{ margin: 0, color: shellPalette.ink, fontSize: 26, lineHeight: 1.08, letterSpacing: -0.4, fontWeight: 680 }}>{title}</Title>
                      {subtitle ? (
                       <Text
                        type="secondary"
                        style={{
                          marginTop: 4,
                          fontSize: 13,
                          maxWidth: 680,
                          display: 'block',
                          lineHeight: 1.55,
                          color: shellPalette.inkSoft,
                        }}
                       >
                         {subtitle}
                        </Text>
                      ) : null}
                </div>
                {extra ? <Space wrap className="page-header__extra" style={{ alignItems: 'center' }}>{extra}</Space> : null}
            </div>
        </div>
  );
};

export default PageHeader;
