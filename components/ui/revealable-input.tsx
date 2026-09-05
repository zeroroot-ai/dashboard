"use client"

import * as React from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { Input } from "@/components/ui/input"

interface RevealableInputProps extends React.ComponentProps<typeof Input> {
  defaultRevealed?: boolean
}

function RevealableInput({
  type,
  defaultRevealed = false,
  className,
  ...props
}: RevealableInputProps) {
  const [shown, setShown] = React.useState(defaultRevealed)

  if (type !== "password") {
    return <Input type={type} className={className} {...props} />
  }

  return (
    <div className="relative">
      <Input
        type={shown ? "text" : "password"}
        className={`pr-9 ${className ?? ""}`.trim()}
        {...props}
      />
      <button
        type="button"
        aria-label={shown ? "Hide secret value" : "Show secret value"}
        className="text-muted-foreground hover:text-foreground absolute right-2.5 top-1/2 -translate-y-1/2"
        onClick={() => setShown((v) => !v)}
      >
        {shown ? (
          <EyeOffIcon className="size-3.5" aria-hidden="true" />
        ) : (
          <EyeIcon className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}

export { RevealableInput }
export type { RevealableInputProps }
