import * as React from "react"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "horizontal" | "vertical"
  decorative?: boolean
}) {
  return (
    <div
      role={decorative ? "none" : "separator"}
      data-slot="separator"
      aria-orientation={orientation}
      className={cn(
        "bg-border",
        orientation === "horizontal"
          ? "h-px w-full"
          : "h-full w-px align-middle",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
