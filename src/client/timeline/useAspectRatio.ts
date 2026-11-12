import { useEffect, useState, type RefObject } from 'react';

export type TimelineLayout = 'row' | 'column';

export type Aspect = {
  layout: TimelineLayout;
  compact: boolean;
};

const readSize = (width: number, height: number): Aspect => ({
  // Square and portrait stay vertical. A clearly wide frame uses a horizontal line.
  layout: width >= height * 1.2 ? 'row' : 'column',
  compact: height > 0 && height < 520,
});

export const useAspectRatio = (ref: RefObject<HTMLElement | null>): Aspect => {
  const [aspect, setAspect] = useState<Aspect>(() =>
    readSize(
      typeof window === 'undefined' ? 0 : window.innerWidth,
      typeof window === 'undefined' ? 1 : window.innerHeight
    )
  );

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = (width: number, height: number) => {
      const next = readSize(width, height);
      setAspect((current) =>
        current.layout === next.layout && current.compact === next.compact
          ? current
          : next
      );
    };
    measure(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return aspect;
};
