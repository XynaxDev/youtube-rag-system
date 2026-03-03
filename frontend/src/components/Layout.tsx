import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { PlaySquare, Github } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Summarize", href: "/summarize" },
  { label: "Compare", href: "/compare" },
  { label: "History", href: "/history" },
];

export function Layout() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  const isSummaryResultRoute = location.pathname === "/summary-result";
  const hideMobileTopNav = isSummaryResultRoute;

  return (
    <>
      <div
        className={cn(
          "hidden md:flex bg-[#050505] text-white relative overflow-x-hidden",
          isSummaryResultRoute ? "h-[100dvh] overflow-y-hidden" : "min-h-[100dvh] overflow-y-visible"
        )}
      >
        <motion.div
          animate={{ width: isCollapsed ? 80 : 260 }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          className="shrink-0"
        />
        <div className="fixed top-0 left-0 h-screen z-[100]">
          <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
        </div>
        <main
          className={cn(
            "flex-1 min-w-0 relative",
            isSummaryResultRoute
              ? "h-full overflow-y-auto overflow-x-hidden"
              : "min-h-[100dvh] overflow-visible"
          )}
        >
          <Outlet />
        </main>
      </div>

      <div className="md:hidden bg-[#050505] text-white min-h-[100dvh] overflow-x-hidden">
        {!hideMobileTopNav && (
          <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-4xl px-4">
            <div className="bg-[#0a0a0a]/70 backdrop-blur-2xl border border-white/10 rounded-full px-6 h-14 flex items-center justify-between shadow-[0_20px_40px_rgba(0,0,0,0.5)]">
              <Link to="/dashboard" className="flex items-center gap-2 group cursor-pointer">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center shadow-lg group-hover:rotate-12 transition-transform">
                  <PlaySquare className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-base tracking-tight font-display">ClipIQ</span>
              </Link>

              <div className="hidden sm:flex items-center gap-1">
                {NAV_ITEMS.map((item) => {
                  const isActive = location.pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={cn(
                        "relative px-4 py-2 text-sm font-medium transition-colors duration-300 rounded-full",
                        isActive ? "text-white bg-white/5" : "text-gray-400 hover:text-white"
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>

              <a
                href="https://github.com/XynaxDev"
                target="_blank"
                rel="noreferrer"
                className="text-gray-400 hover:text-white transition-all hover:scale-110"
              >
                <Github className="w-5 h-5" />
              </a>
            </div>
          </nav>
        )}

        <main className={cn("min-h-[100dvh]", !hideMobileTopNav && "pt-24")}>
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </>
  );
}
