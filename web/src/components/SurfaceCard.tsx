import { Card, type CardProps } from 'antd';
import type { CSSProperties, FC, ReactNode } from 'react';
import { shellMetrics } from '../theme';

interface SurfaceCardProps extends Omit<CardProps, 'styles'> {
  children?: ReactNode;
  bodyStyle?: CSSProperties;
  tone?: 'default' | 'muted';
}

const SurfaceCard: FC<SurfaceCardProps> = ({
  children,
  bodyStyle,
  className,
  tone = 'default',
  title,
  ...rest
}) => (
  <Card
    variant="borderless"
    {...rest}
    title={title}
    className={[
      'surface-card',
      tone === 'muted' ? 'surface-card--muted' : '',
      className,
    ].filter(Boolean).join(' ')}
    styles={{
      header: {
        padding: `18px ${shellMetrics.cardPadding}px 0`,
        background: 'transparent',
        borderBottom: 'none',
      },
      body: {
        padding: shellMetrics.cardPadding,
        ...(bodyStyle || {}),
      },
    }}
  >
    {children}
  </Card>
);

export default SurfaceCard;
