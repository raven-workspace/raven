import { useEffect, useRef } from "react";
import { matches, SHORTCUTS } from "../../lib/shortcuts";

/** Matches the backend range. */
const MAX_MINUTES = 240;
/** How often the idle check runs. The lock lands at most this late. */
const CHECK_MS = 10_000;
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel"] as const;

interface Options {
  /** Only counts down (and handles ⌘L) while true. */
  enabled: boolean;
  onLock: () => void;
}

/**
 * Locks after `minutes` without keyboard or pointer input; ⌘L locks immediately.
 * While `enabled` is false there is no timer and no listener.
 *
 * Idle time is measured with the wall clock (`Date.now()`), not a single long timer:
 * WebKit pauses timers across system sleep and throttles them in the background, so a
 * laptop closed overnight must still lock on wake. The check runs every CHECK_MS and
 * again whenever the window becomes visible or gains focus.
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
    let lastActivity = Date.now();
    let locked = false;
    const lockNow = () => {
      if (locked) return;
      locked = true;
      onLockRef.current();
    };
    const check = () => {
      if (Date.now() - lastActivity >= ms) lockNow();
    };
    const touch = () => {
      // Input after a long gap (e.g. right after wake) must not count before the check.
      check();
      lastActivity = Date.now();
    };
    const onKey = (e: KeyboardEvent) => {
      if (matches(SHORTCUTS.lock, e)) {
        e.preventDefault();
        lockNow();
        return;
      }
      touch();
    };
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener("keydown", onKey, true);
    for (const ev of ACTIVITY_EVENTS) {
      if (ev !== "keydown") document.addEventListener(ev, touch, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", onKey, true);
      for (const ev of ACTIVITY_EVENTS) {
        if (ev !== "keydown") document.removeEventListener(ev, touch, true);
      }
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [enabled, minutes]);
}
