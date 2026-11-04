import { Button } from "../../ui";
import type { LogOrder } from "./usePersistedOrder";

/** Flips a list between newest-first and oldest-first. */
export function OrderButton({ order, onChange, className }: { order: LogOrder; onChange: (o: LogOrder) => void; className?: string }) {
  return (
    <Button
      size="sm"
      className={className}
      aria-label={order === "newest" ? "Newest first. Switch to oldest first" : "Oldest first. Switch to newest first"}
      onClick={() => onChange(order === "newest" ? "oldest" : "newest")}
    >
      {order === "newest" ? "Newest first ↓" : "Oldest first ↑"}
    </Button>
  );
}
