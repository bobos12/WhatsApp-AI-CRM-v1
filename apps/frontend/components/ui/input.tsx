import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "field file:me-2 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-ink aria-invalid:border-red-500 aria-invalid:ring-red-500/15",
        className
      )}
      {...props}
    />
  )
}

export { Input }
