import * as React from "react"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"
import { TabMarker } from "../TabMarker"
import { FADE_MS, canAnimate } from "../motion"

/** The selected tab's mark: a raised surface with an accent underline. It glides between tabs (TabMarker). */
export const TAB_MARK = "rounded-sm bg-surface-hi shadow-[inset_0_-2px_0_var(--color-accent)]"

// Ink: tabs are controls, so sentence-case body text. The active tab gets a surface and an accent underline, drawn
// once by the list's TabMarker so it glides to the next tab.
// Set once the Tabs root has mounted: a panel shown after that (a switch) fades in; the first one doesn't.
const ShownContext = React.createContext<React.RefObject<boolean> | null>(null)

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const shown = React.useRef(false)
  React.useLayoutEffect(() => {
    shown.current = true
  }, [])
  return (
    <ShownContext.Provider value={shown}>
      <TabsPrimitive.Root data-slot="tabs" className={cn("grid gap-3", className)} {...props} />
    </ShownContext.Provider>
  )
}

function TabsList({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("relative isolate inline-grid grid-flow-col items-center justify-start gap-2", className)}
      {...props}
    >
      <TabMarker className={TAB_MARK} />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "h-7 cursor-default select-none whitespace-nowrap rounded-sm px-3 text-body text-muted transition-colors duration-100 hover:text-fg disabled:pointer-events-none disabled:text-faint",
        "data-[state=active]:font-semibold data-[state=active]:text-fg",
        className
      )}
      {...props}
    />
  )
}

/** A tab's panel. Switching to it fades it in (120ms, opacity only), whether Radix mounts it or reuses it for a new value. */
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  const shown = React.useContext(ShownContext)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!shown?.current || !canAnimate(el)) return
    const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" })
    return () => anim.cancel()
  }, [props.value, shown])
  return <TabsPrimitive.Content ref={ref} data-slot="tabs-content" className={cn("outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
