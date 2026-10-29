"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

/**
 * Adjustable text size (spec section 10 rule 6): scales the root font size,
 * which every rem-based Tailwind size follows. The choice is remembered on
 * the device. Sizes are percentages of the normal size.
 */
const SIZES = [87.5, 100, 112.5, 125, 137.5];
const STORAGE_KEY = "sh_text_size";
const DEFAULT_INDEX = 1; // 100%

const noopSubscribe = () => () => {};

function useStoredIndex(): number {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const index = SIZES.findIndex((s) => `${s}%` === raw);
      return index === -1 ? DEFAULT_INDEX : index;
    },
    () => DEFAULT_INDEX, // server snapshot: normal size
  );
}

export function TextSizeControl() {
  const storedIndex = useStoredIndex();
  // Local override so a click updates the UI instantly; the stored value
  // stays the source of truth across visits.
  const [override, setOverride] = useState<number | null>(null);
  const index = override ?? storedIndex;

  useEffect(() => {
    // Updating the DOM (an external system) from an effect is the intended
    // pattern — no React state is set here.
    document.documentElement.style.fontSize = `${SIZES[index]}%`;
  }, [index]);

  function change(delta: number) {
    const next = Math.min(SIZES.length - 1, Math.max(0, index + delta));
    if (next === index) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, `${SIZES[next]}%`);
    } catch {
      // Private browsing may block storage; the size still applies until
      // the page is closed.
    }
    setOverride(next);
  }

  return (
    <div
      role="group"
      aria-label="Text size"
      className="flex items-center gap-1"
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={() => change(-1)}
        disabled={index === 0}
        aria-label="Smaller text (A−)"
      >
        A−
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={() => change(1)}
        disabled={index === SIZES.length - 1}
        aria-label="Larger text (A+)"
      >
        A+
      </Button>
    </div>
  );
}
