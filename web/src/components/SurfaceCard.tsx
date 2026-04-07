import { Card, type CardProps } from 'antd';
import type { CSSProperties, FC, ReactNode } from 'react';
import { useI18n } from '../i18n';
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
  title,
  ...rest
}) => {
  const { t } = useI18n();
  const baseStyle = tone === 'muted'
    ? insetCardStyle
    : contentCardStyle;

  return (
    <Card
      variant="borderless"
      {...rest}
      title={typeof title === 'string' ? t(title) : title}
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
