import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, GitBranch, Network, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

function AnimatedBackdrop() {
  const particles = Array.from({ length: 18 }, (_, index) => ({
    id: index,
    left: `${8 + ((index * 31) % 84)}%`,
    top: `${10 + ((index * 47) % 78)}%`,
    delay: (index % 7) * 0.35,
    duration: 5 + (index % 5),
  }));

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,oklch(0.24_0.07_259/0.72),transparent_34%),linear-gradient(180deg,oklch(0.08_0.012_285),oklch(0.035_0.006_285))]" />
      <div className="absolute inset-0 bg-[linear-gradient(oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/0.04)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(circle_at_center,black,transparent_72%)]" />

      <motion.div
        className="absolute left-1/2 top-1/2 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-400/10"
        animate={{ rotate: 360 }}
        transition={{ duration: 42, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        className="absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/10"
        animate={{ rotate: -360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
      />

      <motion.div
        className="absolute left-[18%] top-[18%] h-72 w-72 rounded-full bg-blue-500/20 blur-3xl"
        animate={{ x: [0, 70, -20, 0], y: [0, 20, 80, 0], opacity: [0.45, 0.75, 0.5, 0.45] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-[12%] right-[14%] h-80 w-80 rounded-full bg-violet-500/16 blur-3xl"
        animate={{ x: [0, -60, 30, 0], y: [0, -50, 20, 0], opacity: [0.35, 0.65, 0.4, 0.35] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
      />

      <svg className="absolute inset-0 h-full w-full opacity-45" aria-hidden="true">
        <defs>
          <linearGradient id="launch-line" x1="0" x2="1">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="50%" stopColor="oklch(0.7 0.18 232 / 0.7)" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => (
          <motion.path
            key={line}
            d={`M ${120 + line * 110} ${120 + line * 35} C ${360 + line * 40} ${40 + line * 80}, ${760 - line * 25} ${360 - line * 45}, ${1180 - line * 80} ${170 + line * 95}`}
            stroke="url(#launch-line)"
            strokeWidth="1"
            fill="none"
            strokeDasharray="8 18"
            animate={{ strokeDashoffset: [0, -220] }}
            transition={{ duration: 7 + line, repeat: Infinity, ease: "linear" }}
          />
        ))}
      </svg>

      {particles.map((particle) => (
        <motion.span
          key={particle.id}
          className="absolute h-1.5 w-1.5 rounded-full bg-cyan-200/70 shadow-[0_0_18px_oklch(0.78_0.15_232/0.9)]"
          style={{ left: particle.left, top: particle.top }}
          animate={{ y: [0, -18, 0], opacity: [0.15, 0.9, 0.15], scale: [0.8, 1.25, 0.8] }}
          transition={{ duration: particle.duration, delay: particle.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

export default function Landing() {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <AnimatedBackdrop />

      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center"
        >
          <div className="mb-8 flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 shadow-2xl backdrop-blur-xl">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-400/40 bg-blue-500/15">
              <GitBranch className="h-4 w-4 text-blue-300" />
            </div>
            <span className="font-mono text-xs uppercase tracking-[0.35em] text-white/70">gMAS Workspace</span>
          </div>

          <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.06em] text-white sm:text-7xl lg:text-8xl">
            Build agent workflows in one place.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-white/56 sm:text-lg">
            Choose a saved project or start a new graph from a focused workspace.
          </p>

          <Link href="/get-started">
            <Button className="mt-10 h-14 rounded-full bg-white px-8 text-base font-medium text-black shadow-[0_24px_80px_-24px_oklch(0.72_0.16_232/0.8)] hover:bg-blue-50">
              Start
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-xs text-white/45">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
              <Network className="h-3.5 w-3.5 text-blue-300" />
              Saved graphs
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-300" />
              Templates
            </span>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
