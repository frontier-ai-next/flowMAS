import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { useChipStyle } from "@/contexts/ChipStyleContext";

const lozengeVariants = cva(
  "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium leading-none tracking-[0.01em] whitespace-nowrap transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-px",
  {
    variants: {
      tone: {
        info: "border-blue-400/30 bg-blue-500/10 text-blue-200",
        success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
        warning: "border-amber-400/30 bg-amber-500/10 text-amber-200",
        danger: "border-red-400/30 bg-red-500/10 text-red-200",
        neutral: "border-white/14 bg-white/5 text-zinc-300",
      },
      emphasis: {
        subtle: "",
        solid:
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_6px_rgba(0,0,0,0.24)] backdrop-blur-[1px]",
      },
      preset: {
        linear: "",
        apple:
          "bg-[linear-gradient(180deg,oklch(0.17_0.01_260/0.9),oklch(0.14_0.01_260/0.9))] border-white/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_8px_rgba(0,0,0,0.28)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
      emphasis: "solid",
      preset: "linear",
    },
  }
);

const dotVariants = cva("size-1.5 rounded-full", {
  variants: {
    tone: {
      info: "bg-blue-300",
      success: "bg-emerald-300",
      warning: "bg-amber-300",
      danger: "bg-red-300",
      neutral: "bg-zinc-400",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

type LozengeProps = React.ComponentProps<"span"> &
  VariantProps<typeof lozengeVariants> & {
    withDot?: boolean;
  };

export function StatusLozenge({
  className,
  tone,
  emphasis,
  withDot = false,
  children,
  ...props
}: LozengeProps) {
  const { chipStyle } = useChipStyle();
  const toneOverride =
    chipStyle === "apple"
      ? tone === "info"
        ? "text-blue-200 border-blue-300/28"
        : tone === "success"
          ? "text-emerald-200 border-emerald-300/28"
          : tone === "warning"
            ? "text-amber-200 border-amber-300/28"
            : tone === "danger"
              ? "text-red-200 border-red-300/28"
              : "text-zinc-200 border-white/18"
      : "";

  return (
    <span className={cn(lozengeVariants({ tone, emphasis, preset: chipStyle }), toneOverride, className)} {...props}>
      {withDot && <span className={cn(dotVariants({ tone }))} aria-hidden />}
      <span>{children}</span>
    </span>
  );
}
