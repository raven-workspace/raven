import { useEffect, useState } from "react";
import "./states.scss";

/** Blank for 150ms so quick loads never flash, then a plain line. */
export function LoadingState({ label }: { label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <p role="status" className="loading-state">
      {`Loading ${label}…`}
    </p>
  );
}
