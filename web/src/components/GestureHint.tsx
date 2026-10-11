import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanZoomHint } from '../panZoom';
import { t } from '../i18n';

// The short "how do I move this map" note for a pan/zoom surface (see
// panZoom.ts): shown when someone scrolls the wheel or drags one finger over
// the map — gestures that belong to the page — and gone again shortly after.
export function useGestureHint() {
  const [hint, setHint] = useState<PanZoomHint | null>(null);
  const timer = useRef(0);
  const show = useCallback((kind: PanZoomHint) => {
    setHint(kind);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHint(null), 1600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [hint, show] as const;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
// The modifier that turns the wheel into zoom, as it's labelled on the visitor's keyboard.
export const zoomKey = () => (isMac ? '⌘' : t('radar.ctrlKey'));

export function GestureHint({ hint }: { hint: PanZoomHint | null }) {
  return (
    <div className={'gesture-hint' + (hint ? ' on' : '')} aria-hidden="true">
      {hint === 'touch' ? t('radar.hintTouch') : t('radar.hintWheel', { key: zoomKey() })}
    </div>
  );
}
