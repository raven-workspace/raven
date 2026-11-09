import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

// Ink: a hairline segment, quiet at rest, accent only while on. 28px tall (in-row control), body-scale type.
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 text-meta font-medium whitespace-nowrap select-none cursor-default transition-colors duration-100 outline-none text-fg-2 hover:bg-surface-hi hover:text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent disabled:pointer-events-none disabled:text-faint data-[state=on]:bg-accent/10 data-[state=on]:text-accent [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-line-2 bg-transparent",
      },
      size: {
        default: "h-8 min-w-8 px-2",
        sm: "h-7 min-w-7 px-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
