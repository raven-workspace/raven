import * as ResizablePrimitive from "react-resizable-panels"
import { cx } from "@/lib/cx"
import "./resizable.scss"

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return <ResizablePrimitive.Group data-slot="resizable-panel-group" className={cx("resizable-group", className)} {...props} />
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

// Ink handle: a 1px --line hairline with an 8px hit area; hover and keyboard focus brighten it to --line-strong.
function ResizableHandle({ className, ...props }: ResizablePrimitive.SeparatorProps) {
  return <ResizablePrimitive.Separator data-slot="resizable-handle" className={cx("resizable-handle", className)} {...props} />
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
