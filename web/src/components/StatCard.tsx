import type { CSSProperties, FC, ReactNode } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { Card, Space, Typography } from 'antd';
import { shellMetrics, shellPalette } from '../theme';

const { Text } = Typography;

type StatIconStyle = CSSProperties & { '--stat-icon-color': string };

interface StatCardProps {
  title: ReactNode;
  value: number | string;
  icon?: ReactNode;
  iconBgColor?: string;
  trend?: number;
  trendLabel?: ReactNode;
  suffix?: string;
  loading?: boolean;
}

const StatCard: FC<StatCardProps> = ({
  title,
  value,
  icon,
  iconBgColor = shellPalette.primary,
  trend,
  trendLabel,
  suffix,
  loading = false,
}) => {
  const trendContent = trend === undefined ? null : (() => {
    const isUp = trend >= 0;
    const color = isUp ? shellPalette.success : shellPalette.danger;
    const Icon = isUp ? ArrowUpOutlined : ArrowDownOutlined;

    return (
      <Space size={4}>
        <Icon style={{ color, fontSize: 12 }} />
        <Text style={{ color, fontSize: 12 }}>{Math.abs(trend)}%</Text>
        {trendLabel ? <Text type="secondary" style={{ fontSize: 12 }}>{trendLabel}</Text> : null}
      </Space>
    );
  })();

  const iconStyle: StatIconStyle = { '--stat-icon-color': iconBgColor };

  return (
    <Card
      variant="borderless"
      loading={loading}
      className="stat-card"
      styles={{ body: { padding: `18px ${shellMetrics.cardPadding}px` } }}
    >
      <div className="stat-card__body">
        <div className="stat-card__top">
          <div>
            <Text className="stat-card__label">{title}</Text>
            <div className="stat-card__value">
              {value}
              {suffix ? <span className="stat-card__suffix">{suffix}</span> : null}
            </div>
          </div>
          {icon ? <div className="stat-card__icon" style={iconStyle}>{icon}</div> : null}
        </div>
        {trendContent}
      </div>
    </Card>
  );
};

export default StatCard;
