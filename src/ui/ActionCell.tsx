import type { ReactNode } from "react";
import { Toolbar } from "./Toolbar";

/** Right-hand action column of a Row. Width comes from its children; never wraps. */
export function ActionCell({ children }: { children: ReactNode }) {
  return <Toolbar gap={2} className="justify-end">{children}</Toolbar>;
}
