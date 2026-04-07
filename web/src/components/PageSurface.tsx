import type { CSSProperties, FC, ReactNode } from 'react';

type PageSurfaceCustomProperties = CSSProperties & {
  '--page-surface-gap'?: string;
  '--page-surface-max-width'?: string;
};

interface PageSurfaceProps {
  children: ReactNode;
  gap?: number;
  maxWidth?: number;
}

const PageSurface: FC<PageSurfaceProps> = ({
  children,
  gap = 20,
  maxWidth = 1560,
}) => {
  const style: PageSurfaceCustomProperties = {
    '--page-surface-gap': `${gap}px`,
    '--page-surface-max-width': `${maxWidth}px`,
  };

  return (
    <div className="page-surface" style={style}>
      {children}
    </div>
  );
};

export default PageSurface;
