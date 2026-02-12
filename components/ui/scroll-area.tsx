import * as React from "react"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="scroll-area"
      className={cn(
        "relative overflow-hidden rounded-lg border bg-slate-950 text-slate-100",
        className
      )}
      {...props}
    >
      <div className="h-full max-h-[480px] w-full overflow-auto p-4">
        {children}
      </div>
    </div>
  )
}

export { ScrollArea }
