import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { useChipStyle } from "@/contexts/ChipStyleContext";

const chipVariants = cva(
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] font-medium tracking-[0.01em] transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out",
  {
    variants: {
      tone: {
        neutral:
          "bg-[color:color-mix(in_oklch,var(--surface-2)_80%,transparent)] border-white/12 text-zinc-300 hover:border-white/20 hover:text-zinc-100 hover:bg-[color:color-mix(in_oklch,var(--surface-3)_85%,transparent)]",
        info:
          "bg-blue-500/10 border-blue-400/25 text-blue-200 hover:bg-blue-500/16 hover:border-blue-400/32",
        success:
          "bg-green-500/10 border-green-400/25 text-green-200 hover:bg-green-500/16 hover:border-green-400/32",
        warning:
          "bg-amber-500/10 border-amber-400/25 text-amber-200 hover:bg-amber-500/16 hover:border-amber-400/32",
        danger:
          "bg-red-500/10 border-red-400/25 text-red-200 hover:bg-red-500/16 hover:border-red-400/32",
      },
      active: {
        true:
          "-translate-y-px",
        false: "",
      },
      preset: {
        linear:
          "rounded-full bg-[color:color-mix(in_oklch,var(--surface-2)_80%,transparent)]",
        apple:
          "rounded-full backdrop-blur-sm bg-[linear-gradient(180deg,oklch(0.18_0.008_260/0.96),oklch(0.145_0.008_260/0.96))] border-white/14 text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
      active: false,
      preset: "linear",
    },
  }
);

type ChipProps = React.ComponentProps<"button"> &
  VariantProps<typeof chipVariants> & {
    asSpan?: boolean;
  };

export function Chip({ className, tone, active, asSpan = false, ...props }: ChipProps) {
  const { chipStyle } = useChipStyle();
  const activeClass =
    chipStyle === "apple"
      ? "bg-[linear-gradient(180deg,oklch(0.28_0.03_250/0.96),oklch(0.22_0.03_250/0.96))] border-blue-300/40 text-blue-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_10px_rgba(0,0,0,0.3)]"
      : "bg-[linear-gradient(180deg,oklch(0.23_0.03_259/0.95),oklch(0.19_0.025_259/0.95))] border-blue-400/35 text-blue-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_10px_rgba(0,0,0,0.28)]";

  if (asSpan) {
    return (
      <span
        className={cn(
          chipVariants({ tone, active, preset: chipStyle }),
          active && activeClass,
          className
        )}
        {...(props as React.ComponentProps<"span">)}
      />
    );
  }

  return (
    <button
      type="button"
      className={cn(
        chipVariants({ tone, active, preset: chipStyle }),
        active && activeClass,
        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 hover:-translate-y-px",
        className
      )}
      {...props}
    />
  );
}
