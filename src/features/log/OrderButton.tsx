import { SortAscendingIcon, SortDescendingIcon } from "@phosphor-icons/react";
import { IconButton } from "../../ui";
import type { LogOrder } from "./usePersistedOrder";

/** Flips a list between newest-first and oldest-first. The icon and its name show the order the list is in now. */
export function OrderButton({ order, onChange, className }: { order: LogOrder; onChange: (o: LogOrder) => void; className?: string }) {
  return (
    <IconButton
      className={className}
      icon={order === "newest" ? SortDescendingIcon : SortAscendingIcon}
      label={order === "newest" ? "Newest first" : "Oldest first"}
      onClick={() => onChange(order === "newest" ? "oldest" : "newest")}
    />
  );
}
