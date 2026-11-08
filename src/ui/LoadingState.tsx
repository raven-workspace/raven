import { useEffect, useState } from "react";

/** Blank for 150ms so quick loads never flash, then a plain line. */
export function LoadingState({ label }: { label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <p role="status" className="m-0 text-meta text-muted-2">
      {`Loading ${label}…`}
    </p>
  );
}
