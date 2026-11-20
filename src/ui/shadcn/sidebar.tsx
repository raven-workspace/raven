import * as React from "react"
import { Slot } from "radix-ui"
import { cx } from "@/lib/cx"
import { Separator } from "@/ui/shadcn/separator"
import "./sidebar.scss"

// Raven's sidebar, from shadcn's: 240px expanded, a 56px icon rail collapsed (DESIGN.md Navigation). It sits in the
// shell's grid column rather than fixed to the window. The window is at least 1100px wide, so shadcn's mobile sheet,
// and the parts Raven doesn't use, are gone. The caller (src/features/engagements/Sidebar.tsx) owns the collapsed
// state, persisted and toggled by ⌘B.

type SidebarState = "expanded" | "collapsed"

const SidebarContext = React.createContext<SidebarState | null>(null)

function useSidebarState() {
  const state = React.useContext(SidebarContext)
  if (!state) throw new Error("Sidebar must be used within a SidebarProvider.")
  return state
}

function SidebarProvider({ open, className, children, ...props }: React.ComponentProps<"div"> & { open: boolean }) {
  return (
    <SidebarContext.Provider value={open ? "expanded" : "collapsed"}>
      <div data-slot="sidebar-wrapper" className={cx("sidebar-wrapper", className)} {...props}>
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

/** Collapsed, `data-collapsible="icon"` on the root narrows it to the rail; the parts below key their rail look on it. */
function Sidebar({ className, children, ...props }: React.ComponentProps<"div">) {
  const state = useSidebarState()
  return (
    <div className="sidebar" data-state={state} data-collapsible={state === "collapsed" ? "icon" : ""} data-slot="sidebar">
      {/* Takes the sidebar's width in the layout, so the panel beside it can be positioned over it. */}
      <div data-slot="sidebar-gap" className="sidebar__gap" />
      <div data-slot="sidebar-container" className={cx("sidebar__container", className)} {...props}>
        <div data-sidebar="sidebar" data-slot="sidebar-inner" className="sidebar__inner">
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-header" data-sidebar="header" className={cx("sidebar-header", className)} {...props} />
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cx("sidebar-separator", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-content" data-sidebar="content" className={cx("sidebar-content", className)} {...props} />
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-group" data-sidebar="group" className={cx("sidebar-group", className)} {...props} />
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cx("sidebar-group-label", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" data-sidebar="menu" className={cx("sidebar-menu", className)} {...props} />
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" data-sidebar="menu-item" className={cx("sidebar-menu-item", className)} {...props} />
}

/** `size="lg"` is a two-line row (a host: glyph, name, IP). */
function SidebarMenuButton({
  asChild = false,
  isActive = false,
  size = "default",
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  size?: "default" | "lg"
}) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cx("sidebar-menu-button", size === "lg" && "sidebar-menu-button--lg", className)}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
}
