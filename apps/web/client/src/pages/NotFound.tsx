import { Button } from "@/components/ui/button";
import { Network, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-foreground relative overflow-hidden">
      <div className="dot-grid-bg absolute inset-0 opacity-20 pointer-events-none" />
      <div className="relative text-center">
        <div className="flex items-center justify-center mb-8">
          <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
            <Network className="w-5 h-5 text-blue-400" />
          </div>
        </div>
        <div className="text-[120px] font-bold font-mono leading-none text-muted-foreground/10 select-none mb-2">404</div>
        <h1 className="text-2xl font-bold mb-2">Page not found</h1>
        <p className="text-muted-foreground text-sm mb-8 max-w-xs mx-auto">
          The graph node you're looking for doesn't exist or has been removed.
        </p>
        <Link href="/">
          <Button className="bg-blue-600 hover:bg-blue-500 text-white h-9 px-5 text-sm">
            <ArrowLeft className="w-3.5 h-3.5 mr-2" />
            Back to Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
