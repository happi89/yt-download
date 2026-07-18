import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-black bg-[#ffffff] px-2.5 py-1 text-base text-[#000000] transition-colors outline-none file:inline-flex file:h-6 file:bg-transparent file:text-sm file:font-medium file:text-[#000000] placeholder:text-[#000000]/70 focus-visible:border-black focus-visible:ring-3 focus-visible:ring-black/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[#f5f5f5] disabled:opacity-50 aria-invalid:border-black aria-invalid:ring-3 aria-invalid:ring-black/20 md:text-sm dark:border-white dark:bg-[#000000] dark:text-[#ffffff] dark:file:text-[#ffffff] dark:placeholder:text-[#ffffff]/70 dark:focus-visible:border-white dark:focus-visible:ring-white/20 dark:disabled:bg-[#111111] dark:aria-invalid:border-white dark:aria-invalid:ring-white/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
