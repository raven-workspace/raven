import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import "./layout.scss";

/** A grid row with explicit tracks, e.g. "auto minmax(0,1fr) 96px". */
export function Row({
  tracks,
  align = "center",
  className,
  children,
}: {
  tracks: string;
  align?: "start" | "center";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx("row", align === "start" && "row--top", className)}
      style={{ gridTemplateColumns: tracks }}
    >
      {children}
    </div>
  );
}
