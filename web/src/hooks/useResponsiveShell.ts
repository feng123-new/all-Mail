import { useEffect, useState } from 'react';

const NARROW_SHELL_BREAKPOINT = 1024;

const readNarrowState = () =>
  typeof window !== 'undefined' && window.innerWidth < NARROW_SHELL_BREAKPOINT;

export function useResponsiveShell() {
  const [isNarrow, setIsNarrow] = useState(readNarrowState);

  useEffect(() => {
    const handleResize = () => setIsNarrow(readNarrowState());
    handleResize();
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isNarrow;
}
