import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, FileText, Scale, Clock, PlaySquare, Github, ChevronLeft, ChevronRight, PlusCircle, Search, LayoutGrid, Sparkles, MessageCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";

const NAV_ITEMS = [
  { label: "Home", icon: Home, href: "/dashboard" },
  { label: "Summaries", icon: FileText, href: "/summarize" },
  { label: "Compare videos", icon: Scale, href: "/compare" },
];

const LIBRARY_ITEMS = [
  { label: "History", icon: Clock, href: "/history" }
];

function SidebarItem({
  item,
  isCollapsed,
  isActive
}: {
  item: any,
  isCollapsed: boolean,
  isActive: boolean
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="relative flex items-center justify-center w-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Link
        to={item.href}
        className={cn(
          "flex items-center group relative transition-all duration-300 rounded-2xl w-full",
          isActive
            ? "bg-blue-600/10 text-blue-400"
            : "text-gray-400 hover:text-white hover:bg-white/5",
          isCollapsed
            ? "w-10 h-10 justify-center p-0"
            : "gap-4 px-4 py-3"
        )}
      >
        <item.icon className={cn(
          "transition-all duration-300 shrink-0",
          isCollapsed ? "w-6 h-6" : "w-5 h-5",
          isActive ? "text-blue-400 scale-110" : "text-gray-600 group-hover:text-white"
        )} />
        {!isCollapsed && <span className="text-sm font-semibold tracking-tight truncate">{item.label}</span>}

        {isActive && !isCollapsed && (
          <motion.div layoutId="activeNav" className="absolute left-0 w-1 h-5 bg-blue-500 rounded-r-full" />
        )}
      </Link>

      {/* Tooltip */}
      <AnimatePresence>
        {isCollapsed && isHovered && (
          <motion.div
            initial={{ opacity: 0, x: -10, scale: 0.95 }}
            animate={{ opacity: 1, x: 14, scale: 1 }}
            exit={{ opacity: 0, x: -10, scale: 0.95 }}
            className="absolute left-full ml-4 px-3 py-1.5 bg-[#1a1c22] border border-white/10 rounded-lg text-xs font-bold text-white whitespace-nowrap z-[200] shadow-2xl pointer-events-none"
          >
            {item.label}
            <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-4 border-transparent border-r-[#1a1c22]" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Sidebar({ isCollapsed, setIsCollapsed }: {
  isCollapsed: boolean,
  setIsCollapsed: (v: boolean) => void
}) {
  const location = useLocation();
  const [isHoveringLogo, setIsHoveringLogo] = useState(false);

  return (
    <motion.aside
      animate={{ width: isCollapsed ? 80 : 260 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="bg-[#0a0a0a] border-r border-white/5 h-screen flex flex-col hidden md:flex relative z-50 shadow-2xl"
    >
      <div
        className={cn("p-6 mb-8 transition-all group relative", isCollapsed ? "px-4 flex justify-center" : "flex items-center justify-between")}
        onMouseEnter={() => setIsHoveringLogo(true)}
        onMouseLeave={() => setIsHoveringLogo(false)}
      >
        <div className={cn("flex items-center gap-3", isCollapsed ? "justify-center" : "")}>
          <div className="relative">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-all duration-500 overflow-hidden">
              <AnimatePresence mode="wait">
                {isCollapsed && isHoveringLogo ? (
                  <motion.button
                    key="toggle-collapsed"
                    initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    exit={{ opacity: 0, scale: 0.5, rotate: 45 }}
                    onClick={() => setIsCollapsed(false)}
                    className="text-white bg-blue-600 w-full h-full flex items-center justify-center"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </motion.button>
                ) : (
                  <motion.div
                    key="logo"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="p-2"
                  >
                    <PlaySquare className="w-6 h-6 text-white" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h1 className="text-white font-bold text-xl tracking-tight font-display">ClipIQ</h1>
            </motion.div>
          )}
        </div>

        {!isCollapsed && (
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 rounded-lg border border-white/5 hover:bg-white/10 text-gray-500 hover:text-white transition-all opacity-0 group-hover:opacity-100"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 px-4 py-2 flex flex-col gap-6">
        {!isCollapsed && (
          <Link to="/summarize" className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-gradient-to-br from-white/5 to-transparent border border-white/10 text-white text-sm font-semibold hover:border-blue-500/30 transition-all group mb-8 shadow-lg">
            <PlusCircle className="w-5 h-5 text-blue-400 group-hover:scale-110 transition-transform" />
            New Analysis
          </Link>
        )}

        <div className="space-y-1">
          <nav className="space-y-3">
            {NAV_ITEMS.map((item) => (
              <SidebarItem
                key={item.href}
                item={item}
                isCollapsed={isCollapsed}
                isActive={location.pathname === item.href}
              />
            ))}
          </nav>

          <div className="py-2" />

          <nav className="space-y-3">
            {LIBRARY_ITEMS.map((item) => (
              <SidebarItem
                key={item.href}
                item={item}
                isCollapsed={isCollapsed}
                isActive={location.pathname === item.href}
              />
            ))}
          </nav>
        </div>
      </div>

      <div className="p-4 border-t border-white/5">
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className={cn(
            "flex items-center rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all p-3",
            isCollapsed ? "justify-center" : "gap-3"
          )}
        >
          <Github className="w-5 h-5" />
          {!isCollapsed && <span>GitHub Star</span>}
        </a>
      </div>
    </motion.aside>
  );
}
