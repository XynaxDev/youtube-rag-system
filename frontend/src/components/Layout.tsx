import { Outlet } from "react-router-dom";
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { motion } from "framer-motion";

export function Layout() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="flex bg-[#050505] text-white overflow-x-hidden min-h-screen relative">
      {/* Sidebar Placeholder */}
      <motion.div
        animate={{ width: isCollapsed ? 80 : 260 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="hidden md:block shrink-0"
      />

      {/* Fixed Sidebar Wrapper */}
      <div className="hidden md:block fixed top-0 left-0 h-screen z-[100]">
        <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      </div>

      <main className="flex-1 min-w-0 relative pb-16 md:pb-0 scroll-mt-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
