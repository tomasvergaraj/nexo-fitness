import { useEffect, useRef } from 'react';

const BLOBS = [
  { kx: [0, 220, -110, 0], ky: [0, -160, 110, 0], dur: 7000,  delay:    0 },
  { kx: [0, -180, 110, 0], ky: [0,  140,  -90, 0], dur: 8500,  delay:    0 },
  { kx: [0,  150,  -75, 0], ky: [0,  180,  -55, 0], dur: 6500,  delay:    0 },
  { kx: [0,  190,  -90, 0], ky: [0, -120,  150, 0], dur: 7800,  delay: 1000 },
];

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function Aurora() {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const items = Array.from(wrapper.querySelectorAll<HTMLDivElement>('[data-aurora-item]'));
    if (!items.length) return;

    let id: number;
    const tick = (time: number) => {
      items.forEach((el, i) => {
        const { kx, ky, dur, delay } = BLOBS[i];
        const t = ((time - delay + dur * 1000) % dur) / dur;
        const raw = t * 3;
        const seg = Math.min(Math.floor(raw), 2);
        const f = easeInOut(raw - seg);
        const x = lerp(kx[seg], kx[seg + 1], f);
        const y = lerp(ky[seg], ky[seg + 1], f);
        el.style.transform = `translate(${x}px,${y}px)`;
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div ref={wrapperRef} className="aurora-wrapper" aria-hidden="true">
      <div data-aurora-item className="aurora-item aurora-item-1"><div className="aurora-blob aurora-blob-1" /></div>
      <div data-aurora-item className="aurora-item aurora-item-2"><div className="aurora-blob aurora-blob-2" /></div>
      <div data-aurora-item className="aurora-item aurora-item-3"><div className="aurora-blob aurora-blob-3" /></div>
      <div data-aurora-item className="aurora-item aurora-item-4"><div className="aurora-blob aurora-blob-4" /></div>
    </div>
  );
}
