import type { FC, ReactNode } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { Card, Space, Typography } from 'antd';
import { shellMetrics, shellPalette } from '../theme';
import { createStatIconStyle, statCardStyle } from '../styles/common';

const { Text } = Typography;

interface StatCardProps {
    title: ReactNode;
    value: number | string;
    icon?: ReactNode;
    iconBgColor?: string;
    trend?: number; // 百分比变化，正数为上升，负数为下降
    trendLabel?: ReactNode;
    suffix?: string;
    loading?: boolean;
}

const StatCard: FC<StatCardProps> = ({
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
        const color = isUp ? shellPalette.success : shellPalette.danger;
        const Icon = isUp ? ArrowUpOutlined : ArrowDownOutlined;

        return (
            <Space size={4} style={{ marginTop: 2 }}>
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
            variant="borderless"
            loading={loading}
            style={statCardStyle}
            styles={{ body: { padding: `18px ${shellMetrics.cardPadding}px` } }}
        >
            <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: shellPalette.muted }}>{title}</Text>
                        <div style={{ fontSize: 28, fontWeight: 750, marginTop: 8, color: shellPalette.ink, lineHeight: 1 }}>
                            {value}
                            {suffix ? <span style={{ fontSize: 13, marginLeft: 6, color: shellPalette.inkSoft, fontWeight: 600 }}>{suffix}</span> : null}
                        </div>
                    </div>
                    {icon ? (
                        <div style={createStatIconStyle(iconBgColor)}>
                            {icon}
                        </div>
                    ) : null}
                </div>
                {renderTrend()}
            </div>
        </Card>
    );
};

export default StatCard;
