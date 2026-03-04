import { Link, useNavigate } from "react-router-dom";
import { FileText, Scale, Clock, Sparkles, ArrowUpRight, Zap } from "lucide-react";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getHistory, HistoryItem } from "../lib/history";
import { cn } from "../lib/utils";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemAnim = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

export function Dashboard() {
  const PAGE_SIZE = 5;
  const [allItems, setAllItems] = useState<HistoryItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const navigate = useNavigate();

  useEffect(() => {
    setAllItems(getHistory());
  }, []);

  const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const recentItems = allItems.slice(pageStart, pageStart + PAGE_SIZE);
  const showPagination = allItems.length > PAGE_SIZE;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleItemClick = (item: HistoryItem) => {
    if (!item.result) return;
    if (item.type === "Summary") {
      navigate("/summary-result", { state: item.result });
    } else {
      navigate("/compare", { state: { ...item.result, restored: true } });
    }
  };

  return (
    <div className="w-full bg-[#050505] selection:bg-blue-500/30 relative pb-[72px]">
      <div className="p-4 md:p-6 lg:p-10 pt-4 md:pt-6">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="max-w-5xl mx-auto"
        >
          {/* Header matching History style */}
          <motion.div variants={itemAnim} className="mb-10 md:mb-12 flex flex-col items-center text-center">
            <div className="flex items-center gap-3 mb-4">
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight font-serif italic mb-0 text-white">Intelligence Hub</h1>
            </div>
            <p className="text-gray-500 text-[10px] md:text-sm font-medium uppercase tracking-[0.2em] opacity-80 px-4 md:px-0">Orchestrating video insights from deep content mapping</p>
          </motion.div>

          {/* Action Cards */}
          <motion.div variants={itemAnim} className="grid md:grid-cols-2 gap-4 md:gap-8 mb-12 md:mb-16">
            <Link to="/summarize" className="group relative bg-[#0f1115] border border-white/5 hover:border-blue-500/40 rounded-[1.25rem] md:rounded-[2.5rem] p-5 md:p-10 transition-all hover:bg-white/[0.03] shadow-2xl overflow-hidden flex flex-col h-full">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative z-10 flex flex-col h-full">
                <div className="w-12 h-12 md:w-16 md:h-16 rounded-2xl md:rounded-3xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-6 md:mb-8 group-hover:scale-110 group-hover:rotate-[10deg] transition-all duration-500 shadow-2xl shadow-blue-500/10">
                  <FileText className="w-6 h-6 md:w-8 md:h-8 text-blue-400" />
                </div>
                <h2 className="text-lg md:text-2xl font-bold mb-1.5 md:mb-3 group-hover:text-blue-400 transition-colors font-serif italic text-white">Summarize Video</h2>
                <p className="text-gray-500 text-[10px] md:text-sm leading-relaxed mb-4 md:mb-8 max-w-[260px] font-medium uppercase tracking-wider flex-1">
                  Generate deep executive brevities with citation mapping.
                </p>
                <div className="flex items-center gap-2 text-blue-400 text-[10px] md:text-xs font-bold uppercase tracking-widest pt-4 border-t border-white/5">
                  Initialize Search <ArrowUpRight className="w-4 h-4" />
                </div>
              </div>
            </Link>

            <Link to="/compare" className="group relative bg-[#0f1115] border border-white/5 hover:border-purple-500/40 rounded-[1.25rem] md:rounded-[2.5rem] p-5 md:p-10 transition-all hover:bg-white/[0.03] shadow-2xl overflow-hidden flex flex-col h-full">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative z-10 flex flex-col h-full">
                <div className="w-12 h-12 md:w-16 md:h-16 rounded-2xl md:rounded-3xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-6 md:mb-8 group-hover:scale-110 group-hover:rotate-[-10deg] transition-all duration-500 shadow-2xl shadow-purple-500/10">
                  <Scale className="w-6 h-6 md:w-8 md:h-8 text-purple-400" />
                </div>
                <h2 className="text-lg md:text-2xl font-bold mb-2 md:mb-3 group-hover:text-purple-400 transition-colors font-serif italic text-white">Comparative View</h2>
                <p className="text-gray-500 text-[10px] md:text-sm leading-relaxed mb-4 md:mb-8 max-w-[260px] font-medium uppercase tracking-wider flex-1">
                  Analyze differentials across dual-stream video data.
                </p>
                <div className="flex items-center gap-2 text-purple-400 text-[10px] md:text-xs font-bold uppercase tracking-widest pt-4 border-t border-white/5">
                  Launch Comparator <ArrowUpRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          </motion.div>

          {/* Recent Activity matching History item style */}
          <motion.div variants={itemAnim}>
            <div className="flex items-center justify-between mb-6 md:mb-8 px-2">
              <h3 className="text-[10px] md:text-xs font-bold uppercase tracking-[0.3em] text-gray-400 flex items-center gap-2 md:gap-3">
                <Clock className="w-3.5 h-3.5 md:w-4 md:h-4 text-blue-500" />
                Recent Intelligence
              </h3>
              <Link to="/history" className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest bg-white/5 px-3 py-1.5 md:px-4 md:py-2 rounded-xl border border-white/5 text-gray-500 hover:text-white hover:bg-blue-600 transition-all">View Archive</Link>
            </div>

            <div className="space-y-6">
              {recentItems.length === 0 ? (
                <div className="py-20 bg-[#0f1115] border border-white/5 border-dashed rounded-[2.5rem] flex flex-col items-center justify-center text-center opacity-40">
                  <Zap className="w-12 h-12 mb-4 text-gray-700" />
                  <p className="text-sm font-bold uppercase tracking-widest">No Recent Mappings Detected</p>
                </div>
              ) : (
                recentItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className="group bg-[#0f1115] border border-white/5 rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-6 flex flex-row items-center justify-between hover:border-blue-500/30 transition-all duration-500 hover:bg-white/[0.03] shadow-2xl cursor-pointer gap-4"
                  >
                    <div className="flex items-center gap-4 md:gap-6 min-w-0">
                      <div className={cn(
                        "w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl flex items-center justify-center border shrink-0 transition-transform duration-500 group-hover:scale-110",
                        item.type === "Summary" ? "bg-transparent border-transparent" : "bg-purple-500/10 border-purple-500/20"
                      )}>
                        {item.type === "Summary" ? <img src="/ytlogo.svg" alt="YouTube" className="w-8 h-8 md:w-10 md:h-10 object-contain" /> : <Scale className="w-5 h-5 md:w-6 md:h-6 text-purple-400" />}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-sm md:text-lg mb-1 truncate group-hover:text-blue-400 transition-colors pr-2 leading-tight">{item.title}</h4>
                        <div className="flex items-center gap-2 text-[8px] md:text-[10px] font-bold uppercase tracking-widest">
                          <span className="text-gray-500">{item.channel}</span>
                          <span className={cn(
                            "px-2 py-0.5 rounded border border-white/5",
                            item.type === "Summary" ? "text-blue-500" : "text-purple-500"
                          )}>{item.type}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="hidden sm:block text-[10px] font-bold text-gray-700 uppercase tracking-widest">
                        {new Date(item.timestamp).toLocaleDateString()}
                      </div>
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-xl">
                        <ArrowUpRight className="w-4 h-4 md:w-5 md:h-5" />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {showPagination && (
              <div className="mt-8 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest rounded-xl border border-white/10 bg-white/5 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 transition-all"
                >
                  Prev
                </button>
                <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-gray-500">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 text-[10px] md:text-xs font-bold uppercase tracking-widest rounded-xl border border-white/10 bg-white/5 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 transition-all"
                >
                  Next
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

