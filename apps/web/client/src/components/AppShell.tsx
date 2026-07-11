// gMAS AppShell — "Runtime Environment" design philosophy
// Persistent sidebar (240px / 48px collapsed) + 48px topbar + content area
// Zinc-950 base, status-driven color, Geist Sans + Geist Mono

import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Bot,
  Activity,
  Settings,
  ChevronLeft,
  Zap,
  PanelLeft,
  Network,
  Sun,
  Moon,
  Server,
  Plus,
  GitBranch,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavCounts } from "@/contexts/NavCountsContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/ThemeContext";

interface NavItem {
  path: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  badge?: string;
  badgeVariant?: "default" | "destructive" | "secondary";
  accent?: string; // CSS color for active accent bar + icon
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Build",
    items: [
      { path: "/workflow", icon: Network, label: "Workflow", accent: "oklch(0.62 0.19 259)" },
      { path: "/agents",   icon: Bot,     label: "Agents",   accent: "oklch(0.66 0.18 305)" },
      { path: "/tools",    icon: Zap,     label: "Tools",    accent: "oklch(0.72 0.15 180)" },
    ],
  },
  {
    label: "Operate",
    items: [
      { path: "/runs", icon: Activity, label: "Runs", badgeVariant: "default", accent: "oklch(0.72 0.17 142)" },
      { path: "/schedules", icon: CalendarClock, label: "Schedules", accent: "oklch(0.68 0.16 280)" },
    ],
  },
  {
    label: "System",
    items: [
      { path: "/providers", icon: Server,   label: "LLM Providers", accent: "oklch(0.78 0.13 80)" },
      { path: "/settings",  icon: Settings, label: "Settings",       accent: "oklch(0.65 0 0)" },
    ],
  },
];

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  breadcrumb?: { label: string; path?: string }[];
  breadcrumbExtra?: React.ReactNode;
  actions?: React.ReactNode;
  runStatus?: "idle" | "running" | "stopped";
}

export function AppShell({ children, title, breadcrumb, breadcrumbExtra, actions, runStatus = "idle" }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const [location] = useLocation();
  const counts = useNavCounts();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 900) setCollapsed(true);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const enrichedGroups = navGroups.map(group => ({
    ...group,
    items: group.items.map(item => {
      if (item.path === "/agents") return { ...item, badge: counts.agents > 0 ? String(counts.agents) : undefined };
      if (item.path === "/tools")  return { ...item, badge: counts.tools  > 0 ? String(counts.tools)  : undefined };
      if (item.path === "/runs")   return { ...item, badge: counts.runs   > 0 ? String(counts.runs)   : undefined };
      return item;
    }),
  }));

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-[15px]">
      {/* Sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 48 : 240 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className="flex flex-col h-full border-r border-border bg-sidebar shrink-0 overflow-hidden"
      >
        {/* Main menu — back to project launcher */}
        <div className={cn(
          "flex items-center h-14 border-b border-border shrink-0",
          collapsed ? "justify-center px-1" : "px-2 pt-2 pb-1"
        )}>
          {!collapsed ? (
            <>
              <Link
                href="/get-started"
                className="group flex items-center gap-2.5 flex-1 min-w-0 px-2 py-1.5 rounded-md hover:bg-accent/40 transition-colors"
              >
                <span className="flex items-center justify-center w-8 h-8 rounded-md shrink-0 border border-blue-500/30 bg-blue-500/10">
                  <GitBranch className="w-4 h-4 text-blue-400" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-foreground leading-tight truncate">gMAS</span>
                  <span className="block text-[10.5px] text-muted-foreground leading-tight truncate">Main menu</span>
                </span>
              </Link>
              <button
                onClick={() => setCollapsed(true)}
                className="ml-1 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors shrink-0"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link
                  href="/get-started"
                  className="flex items-center justify-center w-8 h-8 rounded-md border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/15 transition-colors"
                >
                  <GitBranch className="w-4 h-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Main menu</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Quick create */}
        <div className={cn("shrink-0", collapsed ? "px-1 py-2" : "px-2 py-2.5")}>
          {collapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/workflow?new=1">
                  <div className="flex items-center justify-center w-full h-9 rounded-md bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 hover:border-blue-500/50 transition-colors">
                    <Plus className="w-4 h-4" />
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">New graph</TooltipContent>
            </Tooltip>
          ) : (
            <Link href="/workflow?new=1">
              <div className="group flex items-center gap-2 w-full px-3 py-2 rounded-md text-[13px] font-medium bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 hover:border-blue-500/50 transition-colors">
                <Plus className="w-4 h-4 shrink-0" />
                <span>New graph</span>
                <span className="ml-auto text-[10px] font-mono text-blue-400/60 group-hover:text-blue-400/80">⌘N</span>
              </div>
            </Link>
          )}
        </div>

        {/* Nav */}
        <nav className={cn("flex-1 overflow-y-auto overflow-x-hidden", collapsed ? "py-2" : "pt-3 pb-3 space-y-4")}>
          {enrichedGroups.map((group, gi) => (
            <div key={group.label} className={collapsed && gi > 0 ? "mt-2 mx-2 border-t border-border/40 pt-2" : undefined}>
              {!collapsed && (
                <div className="px-4 mb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                    {group.label}
                  </span>
                </div>
              )}
              <div className={collapsed ? undefined : "space-y-0.5"}>
                {group.items.map((item) => {
                  const isActive = location.startsWith(item.path);
                  const Icon = item.icon;
                  const accent = item.accent || "oklch(0.62 0.19 259)";
                  return collapsed ? (
                    <Tooltip key={item.path} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <Link href={item.path} aria-current={isActive ? "page" : undefined}>
                          <div className={cn(
                            "flex items-center justify-center w-full h-9 my-0.5 relative transition-colors",
                            isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                          )}>
                            {isActive && (
                              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r" style={{ backgroundColor: accent }} />
                            )}
                            <Icon className="w-4 h-4" />
                          </div>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="text-xs">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Link key={item.path} href={item.path} aria-current={isActive ? "page" : undefined}>
                      <div className={cn(
                        "flex items-center gap-2.5 mx-2 pl-3 pr-2 py-1.5 rounded-md text-[13px] transition-all duration-150 relative group",
                        isActive
                          ? "text-foreground bg-accent/80 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                      )}>
                        {isActive && (
                          <div
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r -ml-2"
                            style={{ backgroundColor: accent, boxShadow: `0 0 6px ${accent}` }}
                          />
                        )}
                        <Icon
                          className={cn("w-4 h-4 shrink-0 transition-colors", isActive ? "" : "opacity-60 group-hover:opacity-90")}
                          style={isActive ? { color: accent } : undefined}
                        />
                        <span className="flex-1 truncate font-medium">{item.label}</span>
                        {item.badge && (
                          <span
                            className={cn(
                              "text-[10.5px] font-mono px-1.5 py-0.5 rounded border",
                              item.badgeVariant === "destructive"
                                ? "bg-red-500/15 text-red-400 border-red-500/20"
                                : ""
                            )}
                            style={
                              item.badgeVariant !== "destructive"
                                ? isActive
                                  ? { backgroundColor: `color-mix(in oklch, ${accent} 18%, transparent)`, color: accent, borderColor: `color-mix(in oklch, ${accent} 25%, transparent)` }
                                  : undefined
                                : undefined
                            }
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className={cn(
          "border-t border-border py-2 shrink-0",
          collapsed ? "px-0" : "px-2"
        )}>
          {/* Run status indicator */}
          {!collapsed && (
            <div className="flex items-center gap-2 px-2 py-2 rounded-md mx-0 mb-1">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                runStatus === "running" ? "bg-green-500 animate-pulse shadow-[0_0_4px_oklch(0.72_0.17_142/0.6)]" :
                runStatus === "stopped" ? "bg-red-500" : "bg-zinc-600"
              )} />
              <span className="text-[11px] font-mono text-muted-foreground flex-1 truncate">
                {runStatus === "running" ? "Execution running" :
                 runStatus === "stopped" ? "Execution stopped" : "No active run"}
              </span>
            </div>
          )}
          {/* User pill */}
          {!collapsed && (
            <button className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md hover:bg-accent/40 transition-colors text-left">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-muted text-[11px] font-bold text-muted-foreground shrink-0">
                A
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-foreground leading-tight truncate">Anonymous</span>
                <span className="block text-[10.5px] text-muted-foreground truncate">Local session</span>
              </span>
            </button>
          )}
          {/* Theme toggle */}
          {collapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleTheme}
                  className="flex items-center justify-center w-full h-9 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2.5 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-all duration-150"
            >
              {theme === "dark" ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
              <span className="font-medium">{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
            </button>
          )}
        </div>
      </motion.aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center h-14 border-b border-border bg-sidebar/50 backdrop-blur-sm px-3 sm:px-4 shrink-0 gap-2 sm:gap-3">
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-sm flex-1 min-w-0 overflow-hidden">
            {breadcrumb ? (
              <>
                {breadcrumb.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-muted-foreground/50">/</span>}
                    {crumb.path ? (
                      <Link href={crumb.path} className="text-muted-foreground hover:text-foreground transition-colors">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="text-foreground font-medium">{crumb.label}</span>
                    )}
                  </span>
                ))}
                {breadcrumbExtra && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-muted-foreground/50">/</span>
                    {breadcrumbExtra}
                  </span>
                )}
              </>
            ) : title ? (
              <span className="text-foreground font-medium">{title}</span>
            ) : null}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0 max-w-[62vw] overflow-x-auto overflow-y-hidden">
            {actions}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-hidden min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
