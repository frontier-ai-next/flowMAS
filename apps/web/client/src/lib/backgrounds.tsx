// Professional background components based on industry design patterns
// Cursor, Linear, Vercel design references

export function ProfessionalDotGrid() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      style={{
        backgroundImage: `
          radial-gradient(circle, oklch(0.5 0.001 0) 1.5px, transparent 1.5px)
        `,
        backgroundSize: "40px 40px",
        backgroundPosition: "0px 0px",
        opacity: 0.4,
      }}
    />
  );
}

export function WorkflowCanvasBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[oklch(0.985_0.002_285)] dark:bg-[oklch(0.09_0.004_285)]">
      {/* Ambient radial washes — only in dark theme */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(1200px_700px_at_18%_14%,oklch(0.56_0.12_245/0.05),transparent_58%)] dark:bg-[radial-gradient(1200px_700px_at_18%_14%,oklch(0.56_0.12_245/0.16),transparent_58%)]" />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(1100px_680px_at_85%_82%,oklch(0.7_0.09_185/0.03),transparent_60%)] dark:bg-[radial-gradient(1100px_680px_at_85%_82%,oklch(0.7_0.09_185/0.08),transparent_60%)]" />

      {/* Floating volumetric lights — only visible in dark */}
      <div className="pointer-events-none absolute -left-28 top-16 h-[520px] w-[520px] rounded-full bg-blue-500/[0.02] dark:bg-blue-500/[0.05] blur-[120px] animate-ambient-float-slow" />
      <div className="pointer-events-none absolute right-[-140px] top-1/3 h-[520px] w-[520px] rounded-full bg-cyan-400/[0.015] dark:bg-cyan-400/[0.035] blur-[130px] animate-ambient-float-reverse" />

      {/* Dual-layer technical grid — slightly darker in light, lighter in dark */}
      <svg className="absolute inset-0 h-full w-full text-zinc-400 dark:text-zinc-100 opacity-[0.22] dark:opacity-[0.14]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="workflow-grid-minor" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth="0.25" />
          </pattern>
          <pattern id="workflow-grid-major" width="96" height="96" patternUnits="userSpaceOnUse">
            <rect width="96" height="96" fill="url(#workflow-grid-minor)" />
            <path d="M 96 0 L 0 0 0 96" fill="none" stroke="currentColor" strokeWidth="0.7" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#workflow-grid-major)" />
      </svg>

      {/* Subtle diagonal texture to avoid flatness — only dark */}
      <div className="pointer-events-none absolute inset-0 opacity-0 dark:opacity-[0.08] [background-image:linear-gradient(120deg,transparent_0%,transparent_46%,oklch(0.85_0.01_285/0.2)_50%,transparent_54%,transparent_100%)] [background-size:420px_420px] animate-grid-sweep" />

      {/* Grain layer — only dark */}
      <div className="pointer-events-none absolute inset-0 opacity-0 dark:opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.42)_1px,transparent_0)] [background-size:3px_3px]" />

      {/* Vignette for focus — softer in light */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_55%,rgba(0,0,0,0.06)_100%)] dark:bg-[radial-gradient(circle_at_center,transparent_40%,rgba(0,0,0,0.42)_100%)]" />
    </div>
  );
}

export function LandingHeroBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Animated dot grid base (inspired by Linear) */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle, oklch(0.4 0.001 0) 1px, transparent 1px)
          `,
          backgroundSize: "50px 50px",
          backgroundPosition: "0px 0px",
          opacity: 0.15,
        }}
      />

      {/* Multiple radial glows for depth (Cursor/Apple pattern) */}
      <div className="absolute top-1/4 right-1/3 w-[600px] h-[600px] rounded-full bg-blue-500/[0.07] blur-[120px]" />
      <div className="absolute bottom-1/3 left-1/4 w-[500px] h-[500px] rounded-full bg-purple-500/[0.05] blur-[100px]" />
      <div className="absolute top-1/2 right-1/4 w-[400px] h-[400px] rounded-full bg-cyan-500/[0.03] blur-[80px]" />

      {/* Subtle vignette for edge definition */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.05) 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

export function StatusIndicatorBackground(
  variant: "success" | "warning" | "error" | "info"
) {
  const colorMap = {
    success: "bg-green-500/[0.05]",
    warning: "bg-amber-500/[0.05]",
    error: "bg-red-500/[0.05]",
    info: "bg-blue-500/[0.05]",
  };

  return (
    <div
      className={`absolute inset-0 opacity-20 blur-3xl ${colorMap[variant]}`}
    />
  );
}
