import type { CSSProperties, FC, ReactNode } from 'react';

type PageSurfaceCustomProperties = CSSProperties & {
  '--page-surface-gap'?: string;
  '--page-surface-max-width'?: string;
};

interface PageSurfaceProps {
  children: ReactNode;
  gap?: number;
  maxWidth?: number;
  className?: string;
}

const PageSurface: FC<PageSurfaceProps> = ({
  children,
  gap = 20,
  maxWidth = 1520,
  className,
}) => {
  const style: PageSurfaceCustomProperties = {
    '--page-surface-gap': `${gap}px`,
    '--page-surface-max-width': `${maxWidth}px`,
  };

  return (
    <div className={['page-surface', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </div>
  );
};

export default PageSurface;
