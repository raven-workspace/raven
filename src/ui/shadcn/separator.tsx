import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"
import { cx } from "@/lib/cx"
import "./separator.scss"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cx("separator", className)}
      {...props}
    />
  )
}

export { Separator }
