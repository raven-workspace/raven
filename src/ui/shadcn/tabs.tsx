import * as React from "react"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

// Ink: tabs are controls, so sentence-case body text. The active tab gets a surface and an accent underline.
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("grid gap-3", className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-grid grid-flow-col items-center justify-start gap-2", className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "h-7 cursor-default select-none whitespace-nowrap rounded-sm px-3 text-body text-muted transition-colors duration-100 hover:text-fg disabled:pointer-events-none disabled:text-faint",
        "data-[state=active]:bg-surface-hi data-[state=active]:font-semibold data-[state=active]:text-fg data-[state=active]:shadow-[inset_0_-2px_0_var(--color-accent)]",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
