"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto shadow-[inset_0_-8px_12px_-8px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_-8px_12px_-8px_rgba(0,0,0,0.15)]"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("sticky top-0 z-10 [&_tr_th]:bg-table-header [&_tr_th]:dark:bg-muted/50 [&_tr_th:first-child]:rounded-tl-xl [&_tr_th:last-child]:rounded-tr-xl", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 font-medium",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "data-[state=selected]:bg-muted/70 even:bg-muted/20 transition-colors hover:bg-row-hover dark:hover:bg-muted/60 border-b border-muted/30 last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "bg-table-header dark:bg-muted/50 text-foreground h-11 px-2 text-left align-middle font-bold tracking-tight whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

type SortDirection = "asc" | "desc" | null

function TableHeadSortable({
  className,
  children,
  sortDirection,
  onSort,
  iconVariant = "arrows",
  ...props
}: React.ComponentProps<"th"> & {
  sortDirection: SortDirection
  onSort: () => void
  /** "dual" = Notion/Linear-style: show ⇅ when unsorted, ↑/↓ when sorted (data-centric). Default "arrows" = ↑/↓ only when sorted. */
  iconVariant?: "arrows" | "dual"
}) {
  const isDual = iconVariant === "dual"
  return (
    <th
      data-slot="table-head-sortable"
      role="columnheader"
      aria-sort={
        sortDirection === "asc"
          ? "ascending"
          : sortDirection === "desc"
            ? "descending"
            : undefined
      }
      className={cn(
        "bg-table-header dark:bg-muted/50 text-foreground h-11 px-2 text-left align-middle font-bold tracking-tight whitespace-nowrap cursor-pointer select-none [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      onClick={onSort}
      {...props}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {isDual ? (
          <ArrowUpDown className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
        ) : (
          <>
            {sortDirection === "asc" && (
              <ArrowUp className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
            )}
            {sortDirection === "desc" && (
              <ArrowDown className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
            )}
          </>
        )}
      </span>
    </th>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-2 py-2.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableHeadSortable,
  TableRow,
  TableCell,
  TableCaption,
}
