import React from 'react';
import { Card, Space, Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface StatCardProps {
    title: string;
    value: number | string;
    icon?: React.ReactNode;
    iconBgColor?: string;
    trend?: number; // 百分比变化，正数为上升，负数为下降
    trendLabel?: string;
    suffix?: string;
    loading?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({
    title,
    value,
    icon,
    iconBgColor = '#1890ff',
    trend,
    trendLabel,
    suffix,
    loading = false,
}) => {
    const renderTrend = () => {
        if (trend === undefined) return null;

        const isUp = trend >= 0;
        const color = isUp ? '#52c41a' : '#ff4d4f';
        const Icon = isUp ? ArrowUpOutlined : ArrowDownOutlined;

        return (
            <Space size={4} style={{ marginTop: 8 }}>
                <Icon style={{ color, fontSize: 12 }} />
                <Text style={{ color, fontSize: 12 }}>
                    {Math.abs(trend)}%
                </Text>
                {trendLabel && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {trendLabel}
                    </Text>
                )}
            </Space>
        );
    };

    return (
        <Card
            bordered={false}
            loading={loading}
            styles={{ body: { padding: '20px 24px' } }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <Text type="secondary" style={{ fontSize: 14 }}>{title}</Text>
                    <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>
                        {value}{suffix && <span style={{ fontSize: 14, marginLeft: 4 }}>{suffix}</span>}
                    </div>
                    {renderTrend()}
                </div>
                {icon && (
                    <div
                        style={{
                            width: 48,
                            height: 48,
                            borderRadius: 12,
                            backgroundColor: iconBgColor,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 24,
                            color: '#fff',
                        }}
                    >
                        {icon}
                    </div>
                )}
            </div>
        </Card>
    );
};

export default StatCard;
