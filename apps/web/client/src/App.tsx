import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { ChipStyleProvider } from "./contexts/ChipStyleContext";
import { WorkflowRunProvider } from "./contexts/WorkflowContext";
import { NavCountsProvider } from "./contexts/NavCountsContext";

const Landing = lazy(() => import("./pages/Landing"));
const GetStarted = lazy(() => import("./pages/GetStarted"));
const Workflow = lazy(() => import("./pages/Workflow"));
const Agents = lazy(() => import("./pages/Agents"));
const Tools = lazy(() => import("./pages/Tools"));
const Runs = lazy(() => import("./pages/Runs"));
const Schedules = lazy(() => import("./pages/Schedules"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Router() {
  const [location] = useLocation();

  useEffect(() => {
    const shouldAllowPageScroll = location === "/" || location === "/get-started";
    document.body.style.overflowY = shouldAllowPageScroll ? "auto" : "hidden";
  }, [location]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        className="contents"
      >
        <Suspense fallback={<div className="min-h-screen bg-background" aria-label="Loading page" />}>
          <Switch location={location}>
            <Route path="/" component={Landing} />
            <Route path="/get-started" component={GetStarted} />
            <Route path="/workflow" component={Workflow} />
            <Route path="/workflow/:graphId" component={Workflow} />
            <Route path="/agents" component={Agents} />
            <Route path="/tools" component={Tools} />
            <Route path="/runs" component={Runs} />
            <Route path="/schedules" component={Schedules} />
            <Route path="/providers" component={Settings} />
            <Route path="/settings" component={Settings} />
            <Route path="/404" component={NotFound} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="bottom-right" theme={theme} />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <ChipStyleProvider>
          <WorkflowRunProvider>
            <NavCountsProvider>
            <TooltipProvider>
              <ThemedToaster />
              <Router />
            </TooltipProvider>
            </NavCountsProvider>
          </WorkflowRunProvider>
        </ChipStyleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
