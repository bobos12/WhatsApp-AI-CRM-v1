import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Thin typed wrapper over the `.btn` family in globals.css, so a <Button> and a
// hand-written `className="btn btn-primary"` are guaranteed to look identical.
const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "btn-primary",
      primary: "btn-primary",
      outline: "btn-secondary",
      secondary: "btn-secondary",
      ghost: "btn-ghost",
      destructive: "btn-danger",
      link: "h-auto px-0 text-brand underline-offset-4 shadow-none hover:underline active:scale-100",
    },
    size: {
      default: "",
      xs: "btn-sm h-7 px-2 text-2xs",
      sm: "btn-sm",
      lg: "btn-lg",
      icon: "btn-icon",
      "icon-xs": "btn-icon h-7 w-7",
      "icon-sm": "btn-icon btn-sm",
      "icon-lg": "btn-icon h-10 w-10",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
})

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
