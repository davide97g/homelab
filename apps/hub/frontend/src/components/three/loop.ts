import { useThree } from "@react-three/fiber";
import { useEffect, useState, type RefObject } from "react";

// How every scene in this app decides when to render a frame.
//
// Shared rather than copied, because both scenes need exactly this and a second
// copy would drift the moment one of them was tuned.

/** A hand-driven loop instead of `frameloop="always"`.
 *
 *  `"demand"` is wrong here: the hotspots pulse continuously, so demand would
 *  mean calling `invalidate()` every frame anyway, which is the always-loop with
 *  extra steps. `"always"` is right in spirit but renders at the display's rate,
 *  and these scenes have no business running at 120 Hz behind a dashboard. So
 *  the canvas is `"never"` and this drives `advance()` from one rAF capped at
 *  30 fps — same continuous animation, half the frames, and the visibility gate
 *  is the same switch.
 *
 *  Going idle still paints once, so the last state stays on screen rather than
 *  freezing mid-pulse at whatever opacity the final frame happened to hold. */
export function FrameDriver({ active, fps = 30 }: { active: boolean; fps?: number }) {
  const advance = useThree((s) => s.advance);

  useEffect(() => {
    advance(performance.now());
    if (!active) return;

    const minDelta = 1000 / fps;
    let last = 0;
    let raf = requestAnimationFrame(function tick(t: number) {
      raf = requestAnimationFrame(tick);
      if (t - last < minDelta) return;
      last = t;
      advance(t);
    });

    return () => cancelAnimationFrame(raf);
  }, [active, fps, advance]);

  return null;
}

/** On screen *and* in a foreground tab. Either one alone is not enough: a
 *  backgrounded tab keeps its elements intersecting, and rAF throttling in a
 *  hidden tab is a browser courtesy rather than a guarantee. */
export function useActive(ref: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  const [foreground, setForeground] = useState(() => !document.hidden);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), {
      threshold: 0.05,
    });
    io.observe(el);

    const onVisibility = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ref]);

  return onScreen && foreground;
}
