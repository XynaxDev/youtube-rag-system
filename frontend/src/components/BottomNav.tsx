import { Link, useLocation } from "react-router-dom";
import { Home, Clock, FileText, Scale } from "lucide-react";
import { cn } from "../lib/utils";

const NAV_ITEMS = [
  { label: "Home", icon: Home, href: "/dashboard" },
  { label: "Summarize", icon: FileText, href: "/summarize" },
  { label: "Compare", icon: Scale, href: "/compare" },
  { label: "History", icon: Clock, href: "/history" },
];

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0a0a0a] border-t border-white/10 pb-safe z-50">
      <div className="flex justify-around items-center h-16 px-2">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full gap-1 transition-colors",
                isActive ? "text-blue-500" : "text-gray-500 hover:text-gray-300"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
