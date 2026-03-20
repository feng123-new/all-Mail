import React from 'react';
import { Typography, Breadcrumb, Space } from 'antd';

const { Title, Text } = Typography;

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    breadcrumb?: Array<{ title: string; path?: string }>;
    extra?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    subtitle,
    breadcrumb,
    extra,
}) => {
    return (
        <div style={{ marginBottom: 24 }}>
            {breadcrumb && breadcrumb.length > 0 && (
                <Breadcrumb
                    items={breadcrumb.map((item) => ({
                        title: item.path ? <a href={item.path}>{item.title}</a> : item.title,
                    }))}
                    style={{ marginBottom: 8 }}
                />
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <Title level={4} style={{ marginBottom: 0 }}>{title}</Title>
                    {subtitle && <Text type="secondary">{subtitle}</Text>}
                </div>
                {extra && <Space>{extra}</Space>}
            </div>
        </div>
    );
};

export default PageHeader;
