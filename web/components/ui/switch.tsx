"use client"

import { cn } from "@/lib/utils"

/** A plain accessible switch (role="switch" on a button). Callers label it
 *  with aria-labelledby / aria-label, as a visible <label> can't target a
 *  button's toggle behaviour. */
function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
} & Omit<React.ComponentProps<"button">, "onChange" | "role" | "type">) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        checked ? "bg-signal" : "bg-rule",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-card shadow-sm transition-transform",
          checked && "translate-x-4"
        )}
      />
    </button>
  )
}

export { Switch }
