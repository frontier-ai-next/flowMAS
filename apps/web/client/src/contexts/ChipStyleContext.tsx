import React, { createContext, useContext, useEffect, useState } from "react";

export type ChipStyle = "linear" | "apple";

interface ChipStyleContextType {
  chipStyle: ChipStyle;
  setChipStyle: (style: ChipStyle) => void;
}

const ChipStyleContext = createContext<ChipStyleContextType | undefined>(undefined);

export function ChipStyleProvider({ children }: { children: React.ReactNode }) {
  const [chipStyle, setChipStyle] = useState<ChipStyle>(() => {
    const stored = localStorage.getItem("gmas-chip-style");
    return stored === "apple" ? "apple" : "linear";
  });

  useEffect(() => {
    localStorage.setItem("gmas-chip-style", chipStyle);
    document.documentElement.dataset.chipStyle = chipStyle;
  }, [chipStyle]);

  return (
    <ChipStyleContext.Provider value={{ chipStyle, setChipStyle }}>
      {children}
    </ChipStyleContext.Provider>
  );
}

export function useChipStyle() {
  const context = useContext(ChipStyleContext);
  if (!context) {
    throw new Error("useChipStyle must be used within ChipStyleProvider");
  }
  return context;
}

