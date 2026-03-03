import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Clock, Scale, Trash2, Edit2, Check, X, ArrowUpRight, Search, Zap, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getHistory, clearHistory, deleteHistoryItem, renameHistoryItem, HistoryItem } from "../lib/history";
import { cn } from "../lib/utils";
import { useToast } from "../components/GlobalToast";

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
    const [showConfirmClear, setShowConfirmClear] = useState(false);
    const navigate = useNavigate();
    const { showToast } = useToast();


    useEffect(() => {
        setItems(getHistory());
    }, []);

    const handleItemClick = (item: HistoryItem) => {
        if (!item.result) return;
        if (item.type === "Summary") {
            navigate("/summary-result", { state: item.result });
        } else {
            navigate("/compare-result", { state: { ...item.result, restored: true } });
        }
    };

    const handleClear = () => {
        clearHistory();
        setItems([]);
        setShowConfirmClear(false);
        showToast("History cleared", "success");
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        deleteHistoryItem(id);
        const updated = getHistory();
        setItems(updated);
        showToast("Entry deleted", "success");
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
            showToast("Title updated", "success");
        }
        setEditingId(null);
    };

    return (
        <div className="w-full bg-[#050505] selection:bg-blue-500/30 relative pb-[72px] overflow-x-hidden">
            <div className="p-4 md:p-6 lg:p-10 pt-4 md:pt-6 pb-40">
                <motion.div
                    variants={container}
                    initial="hidden"
                    animate="show"
                    className="max-w-5xl mx-auto"
                >

                    {/* Header with Tooltips/Actions */}
                    <motion.div variants={itemAnim} className="flex flex-col items-center justify-center text-center mb-10 md:mb-16 gap-6">
                        <div className="flex flex-col items-center text-center">
                            <div className="flex items-center gap-3 mb-4">
                                <h1 className="text-3xl md:text-5xl font-bold tracking-tight font-serif italic text-white">Intelligence Archive</h1>
                            </div>
                            <p className="text-gray-500 text-[10px] md:text-sm font-medium uppercase tracking-[0.2em] opacity-80">Managing {items.length} stored platform records</p>
                        </div>

                        <div className="flex items-center justify-center gap-3 w-full md:w-auto px-4">
                            {items.length > 0 && (
                                <div className="relative">
                                    {!showConfirmClear ? (
                                        <button
                                            onClick={() => setShowConfirmClear(true)}
                                            className="px-4 py-2.5 md:px-6 md:py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl md:rounded-2xl transition-all flex items-center gap-2 text-[10px] md:text-xs font-bold uppercase tracking-widest border border-red-500/20 active:scale-95 whitespace-nowrap"
                                        >
                                            <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
                                            Clear History
                                        </button>
                                    ) : (
                                        <motion.div
                                            initial={{ opacity: 0, scale: 0.9 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            className="flex items-center gap-2 bg-[#1a1a1a] p-1 rounded-xl md:rounded-2xl border border-red-500/30 shadow-2xl"
                                        >
                                            <button
                                                onClick={handleClear}
                                                className="px-3 py-2 md:px-4 md:py-2 bg-red-600 text-white text-[9px] md:text-[10px] font-bold uppercase rounded-lg md:rounded-xl hover:bg-red-700 transition-colors"
                                            >
                                                Wipe All
                                            </button>
                                            <button
                                                onClick={() => setShowConfirmClear(false)}
                                                className="px-3 py-2 md:px-4 md:py-2 text-gray-400 text-[9px] md:text-[10px] font-bold uppercase hover:text-white transition-colors"
                                            >
                                                Cancel
                                            </button>
                                        </motion.div>
                                    )}
                                </div>
                            )}
                            <Link to="/summarize" className="px-4 py-2.5 md:px-6 md:py-3 bg-white text-black rounded-xl md:rounded-2xl transition-all flex items-center justify-center gap-2 text-[10px] md:text-xs font-bold uppercase tracking-widest shadow-xl hover:bg-gray-100 active:scale-95">
                                <Zap className="w-3.5 h-3.5 md:w-4 md:h-4" />
                                New Brief
                            </Link>
                        </div>
                    </motion.div>

                    {/* Main List */}
                    {items.length === 0 ? (
                        <motion.div variants={itemAnim} className="flex flex-col items-center justify-center py-32 bg-[#0a0a0a] border border-white/5 rounded-[3rem] text-center px-6 shadow-3xl group relative overflow-hidden">
                            <div className="absolute inset-0 bg-blue-500/[0.02] pointer-events-none" />
                            <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-8 relative">
                                <Clock className="w-12 h-12 text-gray-700 group-hover:text-blue-500 transition-colors duration-500" />
                                <div className="absolute inset-0 bg-blue-500/10 blur-[40px] opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <h3 className="text-3xl font-bold mb-4 font-display text-white">Archive History Empty</h3>
                            <p className="text-gray-500 text-lg max-w-sm mb-12 font-sans leading-relaxed">
                                No stored analyses detected in local memory. Initiate your first content mapping to see results here.
                            </p>
                            <Link to="/summarize" className="px-10 py-5 bg-blue-600 text-white rounded-full font-bold text-sm tracking-[0.2em] uppercase hover:bg-blue-700 transition-all shadow-2xl shadow-blue-600/20 active:scale-95 flex items-center gap-3">
                                <Search className="w-4 h-4" />
                                Scan Now
                            </Link>
                        </motion.div>
                    ) : (
                        <div className="space-y-6 lg:space-y-8">
                            <AnimatePresence mode="popLayout">
                                {items.map((item) => (
                                    <motion.div
                                        layout
                                        variants={itemAnim}
                                        initial="hidden"
                                        animate="show"
                                        exit={{ opacity: 0, x: -50, scale: 0.95 }}
                                        key={item.id}
                                        onClick={() => handleItemClick(item)}
                                        className="group relative bg-[#0f1115] border border-white/5 rounded-[1.25rem] md:rounded-[2.5rem] p-4 md:p-6 lg:p-7 flex flex-col md:flex-row items-stretch md:items-center justify-between cursor-pointer hover:border-blue-500/50 transition-all hover:bg-white/[0.04] shadow-2xl overflow-hidden gap-3 md:gap-6"
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                                        <div className="flex items-center gap-4 md:gap-6 flex-1 min-w-0 relative z-10">
                                            <div className={cn(
                                                "w-10 h-10 md:w-16 md:h-16 rounded-xl md:rounded-2xl flex items-center justify-center border shrink-0 transition-all duration-300 group-hover:scale-105 shadow-lg",
                                                item.type === "Summary" ? "bg-transparent border-transparent" : "bg-purple-500/10 border-purple-500/20"
                                            )}>
                                                {item.type === "Summary" ? (
                                                    <img src="/ytlogo.svg" alt="YouTube" className="w-8 h-8 md:w-12 md:h-12 object-contain" />
                                                ) : (
                                                    <Scale className="w-5 h-5 md:w-7 md:h-7 text-purple-400" />
                                                )}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                {editingId === item.id ? (
                                                    <div className="flex items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="text"
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            className="flex-1 min-w-0 bg-black/60 border border-blue-500/50 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
                                                            autoFocus
                                                        />
                                                        <button onClick={(e) => saveEdit(item.id, e)} className="p-1.5 bg-green-500/20 text-green-400 rounded-lg shrink-0">
                                                            <Check className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={cancelEdit} className="p-1.5 bg-white/5 text-gray-400 rounded-lg shrink-0">
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <h4 className="text-[13px] md:text-xl font-bold mb-1 truncate group-hover:text-blue-400 transition-colors pr-2 leading-tight">
                                                            {item.title}
                                                        </h4>
                                                        <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                                            <span className="truncate max-w-[100px] md:max-w-none">{item.channel}</span>
                                                            <span className="w-1 h-1 rounded-full bg-gray-800 shrink-0" />
                                                            <span className={item.type === "Summary" ? "text-blue-500/70" : "text-purple-500/70"}>{item.type}</span>
                                                            <span className="hidden sm:inline w-1 h-1 rounded-full bg-gray-800" />
                                                            <span className="hidden sm:inline text-gray-600">{item.date}</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {editingId !== item.id && (
                                            <div className="flex items-center justify-between md:justify-end gap-3 md:gap-4 relative z-10 pt-3 md:pt-0 border-t border-white/5 md:border-t-0">
                                                <div className="flex items-center gap-1 md:gap-2">
                                                    <button
                                                        onClick={(e) => startEdit(item, e)}
                                                        className="p-2 md:p-3 text-gray-600 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                                                        title="Rename"
                                                    >
                                                        <Edit2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleDelete(item.id, e)}
                                                        className="p-2 md:p-3 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
                                                    </button>
                                                </div>
                                                <div className="w-8 h-8 md:w-12 md:h-12 rounded-lg md:rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-gray-500 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-500 transition-all shadow-lg ml-1">
                                                    <ArrowUpRight className="w-4 h-4 md:w-5 md:h-5" />
                                                </div>
                                            </div>
                                        )}


                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    );
}

