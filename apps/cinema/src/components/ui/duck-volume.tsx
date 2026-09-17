"use client";

import * as React from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";
import { DuckMediaSlider } from "@/components/ui/duck-media-slider";
import { QuackButton } from "@/components/ui/quack-button";

/**
 * DuckVolume — the tap.
 *
 * A mute toggle with the water hidden behind it: the slider is a closed tap at
 * rest and opens sideways when the pointer or the focus ring arrives, so a
 * player bar spends one icon of width until someone actually wants the level.
 *
 * The design rule is the one every media app gets wrong. video.muted and
 * video.volume are independent, and either one alone makes silence: muted at
 * the old level, or level 0 while unmuted. So the icon and the slider read
 * from the OR of the two, and the toggle hands back a level it remembered —
 * unmuting a slider that sits at 0 would otherwise change the icon and nothing
 * else. Composes DuckMediaSlider dense rather than growing a second slider.
 */

// onVolumeChange is also a DOM media event, so the div's version has to go or
// the level callback would be typed as a SyntheticEvent handler.
export interface DuckVolumeProps
  extends Omit<React.ComponentProps<"div">, "onChange" | "onVolumeChange"> {
  /** 0 to 1, matching video.volume. */
  volume?: number;
  defaultVolume?: number;
  /** Matching video.muted. Independent of volume, on purpose. */
  muted?: boolean;
  defaultMuted?: boolean;
  onVolumeChange?: (volume: number) => void;
  onMutedChange?: (muted: boolean) => void;
  /** Off, the slider stays open. For a settings panel, where nothing is tight. */
  collapsible?: boolean;
}

function DuckVolume({
  className,
  volume,
  defaultVolume = 0.7,
  muted,
  defaultMuted = false,
  onVolumeChange,
  onMutedChange,
  collapsible = true,
  ...props
}: DuckVolumeProps) {
  const [internalVolume, setInternalVolume] = React.useState(defaultVolume);
  const [internalMuted, setInternalMuted] = React.useState(defaultMuted);

  const currentVolume = Math.min(Math.max(volume ?? internalVolume, 0), 1);
  const currentMuted = muted ?? internalMuted;
  const silent = currentMuted || currentVolume === 0;

  // Where the toggle comes back to.
  const audible = React.useRef(defaultVolume || 0.5);

  const setVolume = React.useCallback(
    (next: number) => {
      if (volume === undefined) setInternalVolume(next);
      onVolumeChange?.(next);
    },
    [onVolumeChange, volume]
  );

  const setMuted = React.useCallback(
    (next: boolean) => {
      if (muted === undefined) setInternalMuted(next);
      onMutedChange?.(next);
    },
    [muted, onMutedChange]
  );

  const applyVolume = React.useCallback(
    (next: number) => {
      if (next > 0) audible.current = next;
      setVolume(next);
      // Dragging the water back up is an unmute. The reverse is deliberately
      // not true: dragging to 0 is already silent, and flipping video.muted as
      // well would invent state the consumer never asked for.
      if (next > 0 && currentMuted) setMuted(false);
    },
    [currentMuted, setMuted, setVolume]
  );

  const toggle = React.useCallback(() => {
    if (silent) {
      setMuted(false);
      if (currentVolume === 0) setVolume(audible.current || 0.5);
      return;
    }
    audible.current = currentVolume;
    setMuted(true);
  }, [currentVolume, setMuted, setVolume, silent]);

  const Icon = silent ? VolumeX : currentVolume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      data-slot="duck-volume"
      data-silent={silent || undefined}
      className={cn("group/volume flex items-center gap-1", className)}
      {...props}
    >
      <QuackButton
        type="button"
        variant="ghost"
        size="icon"
        aria-pressed={silent}
        aria-label={silent ? "Unmute" : "Mute"}
        onClick={toggle}
        className="size-9 shrink-0"
      >
        <Icon />
      </QuackButton>
      <div
        className={cn(
          "flex items-center overflow-hidden",
          "transition-[width,opacity] duration-300 ease-[var(--ease-duck)]",
          // Collapsed is zero width, never hidden: the slider stays in the tab
          // order, and focus-within is what opens it for a keyboard user.
          collapsible
            ? cn(
                "w-0 opacity-0",
                "group-hover/volume:w-24 group-hover/volume:opacity-100",
                "group-focus-within/volume:w-24 group-focus-within/volume:opacity-100"
              )
            : "w-24 opacity-100"
        )}
      >
        <DuckMediaSlider
          dense
          min={0}
          max={1}
          step={0.01}
          // Muted shows 0, because 0 is what you hear. The level itself is kept
          // so the toggle can give it back.
          value={silent ? 0 : currentVolume}
          aria-label="Volume"
          formatValue={(next) => `${Math.round(next * 100)}%`}
          // Volume has no timeupdate to fight, so live and commit do the same
          // work here. The split only earns its keep on a seek bar.
          onScrub={applyVolume}
          onSeek={applyVolume}
          className="px-1"
        />
      </div>
    </div>
  );
}

export { DuckVolume };
