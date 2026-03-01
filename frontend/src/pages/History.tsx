import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Clock, FileText, Scale, Trash2, Edit2, Check, X, ArrowUpRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getHistory, clearHistory, deleteHistoryItem, renameHistoryItem, HistoryItem } from "../lib/history";
import { cn } from "../lib/utils";

const container = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.1 }
    }
};

const itemAnim = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
};

export function History() {
    const [items, setItems] = useState<HistoryItem[]>([]);
    const navigate = useNavigate();

    useEffect(() => {
        setItems(getHistory());
    }, []);

    const handleItemClick = (item: HistoryItem) => {
        if (!item.result) return;

        if (item.type === "Summary") {
            navigate("/summary-result", { state: item.result });
        } else {
            // Re-open comparison
            navigate("/compare", { state: { ...item.result, restored: true } });
        }
    };

    const handleClear = () => {
        clearHistory();
        setItems([]);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        deleteHistoryItem(id);
        setItems(getHistory());
    };

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");

    const startEdit = (item: HistoryItem, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(item.id);
        setEditValue(item.title);
    };

    const cancelEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(null);
    };

    const saveEdit = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (editValue.trim()) {
            renameHistoryItem(id, editValue.trim());
            setItems(getHistory());
        }
        setEditingId(null);
    };

    return (
        <div className="min-h-full p-6 lg:p-10 bg-[#050505] selection:bg-blue-500/30">
            <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="max-w-4xl mx-auto"
            >
                <motion.div variants={itemAnim} className="flex items-center justify-between mb-10">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold tracking-tight font-display mb-2">History</h1>
                        <p className="text-gray-400">Your recent video analyses</p>
                    </div>
                    {items.length > 0 && (
                        <button
                            onClick={handleClear}
                            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium border border-red-500/20"
                        >
                            <Trash2 className="w-4 h-4" />
                            Clear History
                        </button>
                    )}
                </motion.div>

                {items.length === 0 ? (
                    <motion.div variants={itemAnim} className="flex flex-col items-center justify-center py-20 bg-[#0f1115] border border-white/5 rounded-[2.5rem] text-center px-4 shadow-2xl">
                        <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
                            <Clock className="w-10 h-10 text-gray-600" />
                        </div>
                        <h3 className="text-2xl font-bold mb-3 font-display">No history yet</h3>
                        <p className="text-gray-400 text-base max-w-sm mb-8 font-sans">
                            You haven't summarized or compared any videos yet. When you do, they will appear here.
                        </p>
                        <div className="flex gap-4">
                            <Link to="/summarize" className="px-8 py-3 bg-white text-black rounded-full font-bold text-sm tracking-widest uppercase hover:bg-gray-100 transition-all shadow-lg active:scale-95">
                                Start Summarizing
                            </Link>
                        </div>
                    </motion.div>
                ) : (
                    <div className="space-y-6">
                        <AnimatePresence mode="popLayout">
                            {items.map((item) => (
                                <motion.div
                                    layout
                                    variants={itemAnim}
                                    initial="hidden"
                                    animate="show"
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    key={item.id}
                                    onClick={() => handleItemClick(item)}
                                    className="group relative bg-[#0f1115] border border-white/5 rounded-[2rem] p-6 flex flex-col sm:flex-row items-center justify-between cursor-pointer hover:border-blue-500/40 transition-all hover:bg-white/[0.03] shadow-2xl overflow-hidden"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                                    <div className="flex items-center gap-6 flex-1 min-w-0 relative z-10 w-full mb-4 sm:mb-0">
                                        <div className={cn(
                                            "w-16 h-16 rounded-[1.25rem] flex items-center justify-center border shrink-0 transition-transform duration-500 group-hover:scale-110",
                                            item.type === "Summary" ? "bg-blue-500/10 border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]" : "bg-purple-500/10 border-purple-500/20 shadow-[0_0_20px_rgba(168,85,247,0.1)]"
                                        )}>
                                            {item.type === "Summary" ? (
                                                <FileText className="w-7 h-7 text-blue-400" />
                                            ) : (
                                                <Scale className="w-7 h-7 text-purple-400" />
                                            )}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            {editingId === item.id ? (
                                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="text"
                                                        value={editValue}
                                                        onChange={(e) => setEditValue(e.target.value)}
                                                        className="flex-1 bg-black/60 border border-blue-500/50 rounded-xl px-4 py-2 text-base text-white focus:outline-none shadow-2xl"
                                                        autoFocus
                                                    />
                                                    <button onClick={(e) => saveEdit(item.id, e)} className="p-2 text-green-400 hover:bg-green-400/10 rounded-xl transition-colors">
                                                        <Check className="w-5 h-5" />
                                                    </button>
                                                    <button onClick={cancelEdit} className="p-2 text-red-400 hover:bg-red-400/10 rounded-xl transition-colors">
                                                        <X className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <h4 className="text-lg sm:text-xl font-bold mb-2 group-hover:text-blue-400 transition-colors truncate font-display pr-4 uppercase tracking-tight">
                                                        {item.title}
                                                    </h4>
                                                    <div className="flex flex-wrap items-center gap-3 text-xs">
                                                        <span className="text-gray-400 font-semibold px-2 py-0.5 rounded-md bg-white/5 border border-white/5">{item.channel}</span>
                                                        <span className={cn(
                                                            "px-2 py-0.5 rounded-md border font-bold text-[10px] uppercase tracking-widest",
                                                            item.type === "Summary" ? "bg-blue-500/5 border-blue-500/10 text-blue-500" : "bg-purple-500/5 border-purple-500/10 text-purple-500"
                                                        )}>
                                                            {item.type}
                                                        </span>
                                                        <span className="text-gray-600 font-medium flex items-center gap-1.5 ml-1">
                                                            <Clock className="w-3 h-3" />
                                                            {item.date}
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 relative z-10 w-full sm:w-auto justify-end border-t border-white/5 sm:border-t-0 pt-4 sm:pt-0">
                                        <div className="group-hover:opacity-0 transition-opacity hidden sm:block">
                                            <span className="text-[10px] font-bold text-gray-700 uppercase tracking-widest bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
                                                {new Date(item.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                            <button
                                                onClick={(e) => startEdit(item, e)}
                                                className="p-3 text-gray-500 hover:text-white hover:bg-white/10 rounded-2xl transition-all border border-transparent hover:border-white/10"
                                                title="Rename"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => handleDelete(item.id, e)}
                                                className="p-3 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-2xl transition-all border border-transparent hover:border-red-400/20"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-600/20">
                                                <ArrowUpRight className="w-5 h-5" />
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
