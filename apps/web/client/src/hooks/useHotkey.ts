import { useEffect } from "react";

type HotkeySpec = {
  key: string;
  mod?: boolean; // ⌘ on mac, Ctrl elsewhere
  shift?: boolean;
  handler: (e: KeyboardEvent) => void;
};

export function useHotkey(specs: HotkeySpec[]) {
  useEffect(() => {
    const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key;
      for (const s of specs) {
        // Match either literal key or its lowercased form (case-insensitive for letters)
        const wantKey = s.key;
        const matches = key === wantKey || key.toLowerCase() === wantKey.toLowerCase();
        if (!matches) continue;
        if (!!s.mod !== mod) continue;
        // For literal "?" the shift state is implicit; allow it
        if (s.shift !== undefined && !!s.shift !== e.shiftKey) continue;
        e.preventDefault();
        s.handler(e);
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [specs]);
}
