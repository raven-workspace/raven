import { useEffect, useRef } from "react";

/** Matches the backend range; also keeps setTimeout under its 2^31-1 ms limit. */
const MAX_MINUTES = 240;
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel"] as const;

interface Options {
  /** Only counts down (and handles ⌘L) while true. */
  enabled: boolean;
  onLock: () => void;
}

/**
 * Locks after `minutes` without keyboard or pointer input; ⌘L locks immediately.
 * While `enabled` is false there is no timer and no listener.
 */
export function useAutoLock(minutes: number, { enabled, onLock }: Options) {
  const onLockRef = useRef(onLock);
  useEffect(() => {
    onLockRef.current = onLock;
  });

  useEffect(() => {
    if (!enabled) return;
    const clamped = Number.isFinite(minutes) ? Math.min(MAX_MINUTES, Math.max(1, minutes)) : 30;
    const ms = clamped * 60_000;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onLockRef.current(), ms);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        clearTimeout(timer);
        onLockRef.current();
        return;
      }
      arm();
    };
    arm();
    document.addEventListener("keydown", onKey, true);
    for (const ev of ACTIVITY_EVENTS) {
      if (ev !== "keydown") document.addEventListener(ev, arm, { capture: true, passive: true });
    }
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      for (const ev of ACTIVITY_EVENTS) {
        if (ev !== "keydown") document.removeEventListener(ev, arm, true);
      }
    };
  }, [enabled, minutes]);
}
