import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { cx } from "@/lib/cx"
import "./toggle-group.scss"

// Ink: one 28px hairline pill of segments, thin dividers between them, no gaps; quiet at rest, accent only while on.
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root data-slot="toggle-group" className={cx("toggle-group", className)} {...props} />
}

function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return <ToggleGroupPrimitive.Item data-slot="toggle-group-item" className={cx("toggle-group__item", className)} {...props} />
}

export { ToggleGroup, ToggleGroupItem }
