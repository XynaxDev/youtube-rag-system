import { Link } from "react-router-dom";
import { FileText, Scale, Clock, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getHistory, HistoryItem } from "../lib/history";

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
  const [recentItems, setRecentItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    setRecentItems(getHistory().slice(0, 3));
  }, []);

  return (
    <div className="min-h-full p-6 lg:p-10 bg-[#050505] selection:bg-blue-500/30">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="max-w-6xl mx-auto"
      >
        <motion.div variants={itemAnim} className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight font-display mb-2">Intelligence Hub</h1>
          <p className="text-gray-400">What would you like to analyze today?</p>
        </motion.div>

        <motion.div variants={itemAnim} className="grid md:grid-cols-2 gap-6 mb-12">
          <Link to="/summarize" className="group bg-[#0f1115] border border-white/5 hover:border-blue-500/30 rounded-2xl p-6 transition-all hover:bg-white/[0.02]">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <FileText className="w-6 h-6 text-blue-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-blue-400 transition-colors">Summarize a Video</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Paste a YouTube link to get an instant AI summary, key takeaways, and a full transcript analysis.
            </p>
          </Link>

          <Link to="/compare" className="group bg-[#0f1115] border border-white/5 hover:border-blue-500/30 rounded-2xl p-6 transition-all hover:bg-white/[0.02]">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Scale className="w-6 h-6 text-purple-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-purple-400 transition-colors">Compare Videos</h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Not sure which tutorial to watch? Compare two videos side-by-side to see which delivers more value.
            </p>
          </Link>
        </motion.div>

        <motion.div variants={itemAnim}>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-500" />
              Recent Activity
            </h3>
            <Link to="/history" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">View all</Link>
          </div>

          <div className="space-y-4">
            {recentItems.length === 0 ? (
              <div className="text-gray-500 text-sm py-4 border border-white/5 rounded-xl text-center bg-[#0f1115]">
                No recent activity. Try summarizing a video!
              </div>
            ) : (
              recentItems.map((item) => (
                <div key={item.id} className="bg-[#0f1115] border border-white/5 rounded-xl p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
                      {item.type === "Summary" ? <FileText className="w-5 h-5 text-gray-400" /> : <Scale className="w-5 h-5 text-gray-400" />}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-medium text-sm mb-1 truncate pr-4">{item.title}</h4>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="truncate max-w-[80px] sm:max-w-none">{item.channel}</span>
                        <span className="w-1 h-1 rounded-full bg-gray-700 shrink-0"></span>
                        <span className="shrink-0">{item.type}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] sm:text-xs text-gray-500 shrink-0 ml-2">{new Date(item.timestamp).toLocaleDateString()}</div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
