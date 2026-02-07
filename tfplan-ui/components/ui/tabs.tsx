import * as React from "react"

import { cn } from "@/lib/utils"

type TabsContextValue = {
  value: string
  onChange: (val: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  value?: string
  defaultValue?: string
  onValueChange?: (val: string) => void
  className?: string
  children: React.ReactNode
}) {
  const [internal, setInternal] = React.useState<string>(
    controlledValue ?? defaultValue ?? ""
  )
  const isControlled = controlledValue !== undefined
  const currentValue = isControlled ? controlledValue! : internal

  const handleChange = React.useCallback(
    (val: string) => {
      if (!isControlled) setInternal(val)
      onValueChange?.(val)
    },
    [isControlled, onValueChange]
  )

  return (
    <TabsContext.Provider
      value={{
        value: currentValue,
        onChange: handleChange,
      }}
    >
      <div data-slot="tabs" className={cn("space-y-3", className)}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

function TabsList({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="tabs-list"
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border bg-white p-1 shadow-xs",
        className
      )}
    >
      {children}
    </div>
  )
}

function TabsTrigger({
  value,
  className,
  children,
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error("TabsTrigger must be used within Tabs")
  const isActive = ctx.value === value

  return (
    <button
      type="button"
      data-slot="tabs-trigger"
      data-state={isActive ? "active" : "inactive"}
      onClick={() => ctx.onChange(value)}
      className={cn(
        "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        isActive
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-600 hover:bg-slate-100",
        className
      )}
    >
      {children}
    </button>
  )
}

function TabsContent({
  value,
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error("TabsContent must be used within Tabs")
  if (ctx.value !== value) return null

  return (
    <div
      data-slot="tabs-content"
      className={cn("rounded-lg border bg-white p-4 shadow-xs", className)}
    >
      {children}
    </div>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
