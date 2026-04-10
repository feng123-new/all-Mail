import type { FC } from 'react';
import dayjs from 'dayjs';
import { shellPalette } from '../../theme';

type LineDatum = {
  date: string;
  count: number;
};

export interface SimpleLineChartProps {
  data: LineDatum[];
  color?: string;
  height?: number;
  ariaLabel: string;
}

export interface SimpleDonutDatum {
  type: string;
  value: number;
  color: string;
}

export interface SimpleDonutChartProps {
  data: SimpleDonutDatum[];
  total: number;
  title: string;
  height?: number;
  ariaLabel: string;
}

const lineChartPadding = {
  top: 20,
  right: 20,
  bottom: 42,
  left: 28,
};

const polarToCartesian = (cx: number, cy: number, radius: number, angleInDegrees: number) => {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
};

const describeArc = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [`M ${start.x} ${start.y}`, `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`].join(' ');
};

export const SimpleLineChart: FC<SimpleLineChartProps> = ({
  data,
  color = shellPalette.primary,
  height = 280,
  ariaLabel,
}) => {
  const width = 640;
  const innerWidth = width - lineChartPadding.left - lineChartPadding.right;
  const innerHeight = height - lineChartPadding.top - lineChartPadding.bottom;
  const maxValue = Math.max(...data.map((item) => item.count), 1);
  const minValue = Math.min(...data.map((item) => item.count), 0);
  const range = Math.max(maxValue - minValue, 1);

  const points = data.map((item, index) => {
    const x = lineChartPadding.left + (data.length === 1 ? innerWidth / 2 : (index / Math.max(data.length - 1, 1)) * innerWidth);
    const y = lineChartPadding.top + innerHeight - ((item.count - minValue) / range) * innerHeight;
    return { ...item, x, y };
  });

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = points.length > 0
    ? `${path} L ${points[points.length - 1].x} ${lineChartPadding.top + innerHeight} L ${points[0].x} ${lineChartPadding.top + innerHeight} Z`
    : '';

  return (
    <div className="chart-frame" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id="lineChartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <line
          x1={lineChartPadding.left}
          y1={lineChartPadding.top + innerHeight}
          x2={width - lineChartPadding.right}
          y2={lineChartPadding.top + innerHeight}
          stroke={shellPalette.borderStrong}
          strokeWidth="1"
        />
        <line
          x1={lineChartPadding.left}
          y1={lineChartPadding.top}
          x2={lineChartPadding.left}
          y2={lineChartPadding.top + innerHeight}
          stroke={shellPalette.border}
          strokeWidth="1"
        />
        {areaPath ? <path d={areaPath} fill="url(#lineChartFill)" /> : null}
        {path ? <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {points.map((point) => (
          <g key={`${point.date}-${point.count}`}>
            <circle cx={point.x} cy={point.y} r="4" fill={shellPalette.surface} stroke={color} strokeWidth="2" />
            <text x={point.x} y={height - 14} textAnchor="middle" fontSize="11" fill={shellPalette.muted}>
              {dayjs(point.date).format('MM-DD')}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

export const SimpleDonutChart: FC<SimpleDonutChartProps> = ({
  data,
  total,
  title,
  height = 280,
  ariaLabel,
}) => {
  const width = 320;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 78;
  const normalizedData = data.filter((item) => item.value > 0);
  const arcSegments = normalizedData.reduce<Array<SimpleDonutDatum & { startAngle: number; endAngle: number }>>((segments, item) => {
    const previousEndAngle = segments.length > 0 ? segments[segments.length - 1].endAngle : 0;
    const angle = total > 0 ? (item.value / total) * 360 : 0;
    segments.push({
      ...item,
      startAngle: previousEndAngle,
      endAngle: previousEndAngle + angle,
    });
    return segments;
  }, []);

  return (
    <div className="chart-frame" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {arcSegments.map((item) => (
            <path
              key={`${item.type}-${item.value}`}
              d={describeArc(centerX, centerY, radius, item.startAngle, item.endAngle)}
              fill="none"
              stroke={item.color}
              strokeWidth="22"
              strokeLinecap="round"
            />
        ))}
        <circle cx={centerX} cy={centerY} r="50" fill={shellPalette.surface} />
        <text x={centerX} y={centerY - 6} textAnchor="middle" fontSize="14" fill={shellPalette.muted}>
          {title}
        </text>
        <text x={centerX} y={centerY + 20} textAnchor="middle" fontSize="30" fontWeight="700" fill={shellPalette.ink}>
          {total}
        </text>
      </svg>
    </div>
  );
};
