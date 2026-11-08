import { useEffect, useState } from 'react';

/** 订阅一个媒体查询；用于在窄屏改文案（CSS 改不了 placeholder） */
export function useMediaQuery(query: string): boolean {
  const read = () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches);
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 900px)');
}
