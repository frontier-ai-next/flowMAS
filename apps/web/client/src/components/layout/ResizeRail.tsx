import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface ResizeRailProps {
  side?: "left" | "right";
  onResize: (delta: number) => void;
}

export function ResizeRail({ side = "right", onResize }: ResizeRailProps) {
  const start = useRef<number | null>(null);

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    start.current = event.clientX;

    const onMove = (moveEvent: MouseEvent) => {
      if (start.current === null) return;
      const delta = moveEvent.clientX - start.current;
      onResize(side === "right" ? -delta : delta);
      start.current = moveEvent.clientX;
    };

    const onUp = () => {
      start.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onResize, side]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "group relative h-full w-2 shrink-0 cursor-ew-resize",
        side === "right" ? "order-first" : "order-last"
      )}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-colors group-hover:bg-blue-400/70" />
    </div>
  );
}
