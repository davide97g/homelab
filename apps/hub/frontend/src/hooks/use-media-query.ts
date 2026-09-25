import { useEffect, useState } from "react";

/** A CSS media query, readable from JS.
 *
 *  Needed because a handful of things on this page are sized in *numbers* rather
 *  than classes -- the gauges and the hero canvas take a pixel size, so there is
 *  no `sm:` to hang a smaller one on. Everything that can be done with a
 *  breakpoint class still is; this is only for the props.
 *
 *  Read synchronously on the first render so the gauge is drawn at the right size
 *  rather than laid out large and corrected a frame later. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `sm` breakpoint, as the phone/not-phone question the layout asks
 *  everywhere else. Keep the number in step with the `sm:` classes. */
export function useCompact(): boolean {
  return useMediaQuery("(max-width: 639px)");
}

/** A phone turned sideways is 844x390: wide enough to be handed the desktop
 *  layout and far too short for it. Width alone cannot tell the two apart, so
 *  anything sized for a tall window asks this as well. */
export function useShortViewport(): boolean {
  return useMediaQuery("(max-height: 560px)");
}
