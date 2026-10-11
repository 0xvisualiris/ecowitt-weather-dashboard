import { useEffect, useLayoutEffect, useRef } from 'react';
import { createSpring, prefersReducedMotion } from '../spring';

export type SegmentedItem = { key: string; label: React.ReactNode; disabled?: boolean };

// A segmented control (iOS tab bar / picker) with one sliding highlight
// instead of each button flipping its own background on and off — the
// highlight glides to the newly-selected button along a critically-damped
// spring, reading its *current* on-screen position as the start every time
// so a quick second tap mid-glide redirects smoothly instead of restarting.
export function Segmented({
  items, value, onChange, ariaLabel, kind = 'tab', as = 'div', size, trackClassName = 'segs', itemClassName = 'seg', inset, children,
}: {
  items: SegmentedItem[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  // 'tab'/'radio' follow the tablist/radiogroup ARIA patterns (used for in-page
  // pickers); 'nav' renders no role on the buttons but aria-current="page" on
  // the active one, for use inside a caller-provided <nav> landmark.
  kind?: 'tab' | 'radio' | 'nav';
  as?: 'div' | 'nav';
  size?: 'sm' | 'xs';
  trackClassName?: string;
  itemClassName?: string;
  inset?: boolean;
  children?: React.ReactNode;
}) {
  const trackRef = useRef<HTMLElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const springRef = useRef<ReturnType<typeof createSpring> | null>(null);
  const mounted = useRef(false);

  if (!springRef.current) {
    springRef.current = createSpring(v => {
      const thumb = thumbRef.current;
      if (!thumb) return;
      thumb.style.transform = `translate(${v.x}px, ${v.y}px)`;
      thumb.style.width = `${v.w}px`;
      thumb.style.height = `${v.h}px`;
    });
  }

  const measure = (animate: boolean) => {
    const btn = btnRefs.current[value];
    const thumb = thumbRef.current;
    if (!btn || !thumb) { if (thumb) thumb.style.opacity = '0'; return; }
    thumb.style.opacity = '1';
    const next = { x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight };
    if (!animate || prefersReducedMotion()) springRef.current!.jumpTo(next);
    else springRef.current!.setTarget(next);
    // A track that scrolls sideways (the nav on a phone) must never hide its
    // own selection: bring the selected item to the middle.
    const track = trackRef.current;
    if (track && track.scrollWidth > track.clientWidth) {
      track.scrollTo({ left: btn.offsetLeft - (track.clientWidth - btn.offsetWidth) / 2, behavior: animate && !prefersReducedMotion() ? 'smooth' : 'auto' });
    }
    updateFades();
  };

  // Marks which edges have more items scrolled out of view, so CSS can fade
  // that edge instead of cutting an item off mid-word.
  const updateFades = () => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    track.toggleAttribute('data-more-left', track.scrollLeft > 4);
    track.toggleAttribute('data-more-right', track.scrollLeft < max - 4);
  };

  useLayoutEffect(() => {
    measure(mounted.current);
    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, items.map(i => i.key).join('|')]);

  useEffect(() => {
    const onResize = () => measure(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const trackRole = kind === 'tab' ? 'tablist' : kind === 'radio' ? 'radiogroup' : undefined;
  const trackClassNameFull = trackClassName + (inset ? ' inset' : '');

  const content = (
    <>
      <div ref={thumbRef} className="seg-thumb" aria-hidden="true" style={{ opacity: 0 }} />
      {items.map(it => (
        <button
          key={it.key}
          ref={el => { btnRefs.current[it.key] = el; }}
          type="button"
          disabled={it.disabled}
          role={kind === 'tab' ? 'tab' : kind === 'radio' ? 'radio' : undefined}
          aria-selected={kind === 'tab' ? it.key === value : undefined}
          aria-checked={kind === 'radio' ? it.key === value : undefined}
          aria-current={kind === 'nav' ? (it.key === value ? 'page' : undefined) : undefined}
          className={itemClassName + (size ? ' ' + size : '') + (it.key === value ? ' on' : '')}
          onClick={() => onChange(it.key)}
        >{it.label}</button>
      ))}
      {children}
    </>
  );

  if (as === 'nav') {
    return <nav ref={trackRef as React.RefObject<HTMLElement>} className={trackClassNameFull} aria-label={ariaLabel} onScroll={updateFades}>{content}</nav>;
  }
  return <div ref={trackRef as React.RefObject<HTMLDivElement>} className={trackClassNameFull} role={trackRole} aria-label={ariaLabel} onScroll={updateFades}>{content}</div>;
}
