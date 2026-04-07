import { Card, type CardProps } from 'antd';
import type { CSSProperties, FC, ReactNode } from 'react';
import { contentCardStyle, insetCardStyle, shellMetrics, shellPalette, shellRadii } from '../theme';

interface SurfaceCardProps extends Omit<CardProps, 'styles'> {
  children?: ReactNode;
  bodyStyle?: CSSProperties;
  tone?: 'default' | 'muted';
}

const SurfaceCard: FC<SurfaceCardProps> = ({
  children,
  bodyStyle,
  tone = 'default',
  style,
  ...rest
}) => {
  const baseStyle = tone === 'muted'
    ? insetCardStyle
    : contentCardStyle;

  return (
    <Card
      variant="borderless"
      {...rest}
      style={{
        ...baseStyle,
        borderRadius: shellRadii.card,
        overflow: 'hidden',
        ...style,
      }}
      styles={{
        header: {
          padding: `18px ${shellMetrics.cardPadding}px 0`,
          background: 'transparent',
          borderBottom: 'none',
          color: shellPalette.ink,
        },
        body: {
          padding: shellMetrics.cardPadding,
          color: shellPalette.ink,
          ...(bodyStyle || {}),
        },
      }}
    >
      {children}
    </Card>
  );
};

export default SurfaceCard;
