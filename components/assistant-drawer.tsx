"use client"

import * as React from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"

type AssistantDrawerProps = {
  isOpen: boolean
  onClose: () => void
  title?: string
  header?: React.ReactNode
  subheader?: React.ReactNode
  children: React.ReactNode
  width?: number
}

export function AssistantDrawer({
  isOpen,
  onClose,
  title = "Assistant",
  header,
  subheader,
  children,
  width = 520,
}: AssistantDrawerProps) {
  const drawerRef = React.useRef<HTMLDivElement | null>(null)
  const previouslyFocused = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }
    if (isOpen) {
      previouslyFocused.current = document.activeElement as HTMLElement
      document.addEventListener("keydown", handleKey)
      drawerRef.current?.focus()
    } else {
      document.removeEventListener("keydown", handleKey)
      previouslyFocused.current?.focus?.()
    }
    return () => document.removeEventListener("keydown", handleKey)
  }, [isOpen, onClose])

  const drawerWidth = Math.min(Math.max(width, 320), 640)

  return (
    <div
      ref={drawerRef}
      tabIndex={-1}
      style={{ width: drawerWidth }}
      className={`fixed inset-y-0 right-0 z-40 flex h-screen transform bg-card shadow-2xl transition-transform duration-200 ease-out focus:outline-none ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex h-full w-full flex-col">
        <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-base font-semibold text-foreground">{title}</span>
              {header}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close assistant">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {subheader ? <div className="mt-2 space-y-1 text-xs text-muted-foreground">{subheader}</div> : null}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
  )
}
