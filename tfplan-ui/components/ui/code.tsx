import * as React from "react"

import { cn } from "@/lib/utils"

function Code({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLPreElement>) {
  return (
    <pre
      data-slot="code"
      className={cn(
        "font-mono text-sm leading-6 whitespace-pre-wrap break-words",
        className
      )}
      {...props}
    >
      {children}
    </pre>
  )
}

export { Code }
