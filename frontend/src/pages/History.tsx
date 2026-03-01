import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Clock, FileText, Scale, Trash2, Edit2, Check, X, ArrowUpRight, Search, Zap, AlertCircle } from "lucide-react";
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
    const [showConfirmClear, setShowConfirmClear] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        setItems(getHistory());
    }, []);

    const handleItemClick = (item: HistoryItem) => {
        if (!item.result) return;
        if (item.type === "Summary") {
            navigate("/summary-result", { state: item.result });
        } else {
            navigate("/compare", { state: { ...item.result, restored: true } });
        }
    };

    const handleClear = () => {
        clearHistory();
        setItems([]);
        setShowConfirmClear(false);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        deleteHistoryItem(id);
        const updated = getHistory();
        setItems(updated);
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
                className="max-w-5xl mx-auto"
            >
                {/* Header with Tooltips/Actions */}
                <motion.div variants={itemAnim} className="flex flex-col md:flex-row items-start md:items-center justify-between mb-12 gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
                            <h1 className="text-4xl font-bold tracking-tight font-display">Intelligence Archive</h1>
                        </div>
                        <p className="text-gray-500 text-sm font-medium uppercase tracking-[0.2em] opacity-80">Managing {items.length} stored neural mappings</p>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto">
                        {items.length > 0 && (
                            <div className="relative">
                                {!showConfirmClear ? (
                                    <button
                                        onClick={() => setShowConfirmClear(true)}
                                        className="px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-2xl transition-all flex items-center gap-2 text-xs font-bold uppercase tracking-widest border border-red-500/20 active:scale-95 whitespace-nowrap"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Clear History
                                    </button>
                                ) : (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="flex items-center gap-2 bg-[#1a1a1a] p-1 rounded-2xl border border-red-500/30 shadow-2xl"
                                    >
                                        <button
                                            onClick={handleClear}
                                            className="px-4 py-2 bg-red-600 text-white text-[10px] font-bold uppercase rounded-xl hover:bg-red-700 transition-colors"
                                        >
                                            Wipe All
                                        </button>
                                        <button
                                            onClick={() => setShowConfirmClear(false)}
                                            className="px-4 py-2 text-gray-400 text-[10px] font-bold uppercase hover:text-white transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </motion.div>
                                )}
                            </div>
                        )}
                        <Link to="/summarize" className="flex-1 md:flex-none px-6 py-3 bg-white text-black rounded-2xl transition-all flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest shadow-xl hover:bg-gray-100 active:scale-95">
                            <Zap className="w-4 h-4" />
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
                        <h3 className="text-3xl font-bold mb-4 font-display text-white">Neural History Empty</h3>
                        <p className="text-gray-500 text-lg max-w-sm mb-12 font-sans leading-relaxed">
                            No stored analyses detected in local memory. Initiate your first RAG mapping to see results here.
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
                                    className="group relative bg-[#0f1115] border border-white/5 rounded-[2.5rem] p-8 flex flex-col sm:flex-row items-center justify-between cursor-pointer hover:border-blue-500/50 transition-all hover:bg-white/[0.04] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] overflow-hidden"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                                    <div className="flex items-center gap-8 flex-1 min-w-0 relative z-10 w-full mb-6 sm:mb-0">
                                        <div className={cn(
                                            "w-20 h-20 rounded-[1.75rem] flex items-center justify-center border shrink-0 transition-all duration-700 group-hover:rotate-[15deg] group-hover:scale-110 shadow-2xl",
                                            item.type === "Summary" ? "bg-blue-500/10 border-blue-500/20" : "bg-purple-500/10 border-purple-500/20"
                                        )}>
                                            {item.type === "Summary" ? (
                                                <FileText className="w-8 h-8 text-blue-400" />
                                            ) : (
                                                <Scale className="w-8 h-8 text-purple-400" />
                                            )}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            {editingId === item.id ? (
                                                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="text"
                                                        value={editValue}
                                                        onChange={(e) => setEditValue(e.target.value)}
                                                        className="flex-1 bg-black/80 border border-blue-500/50 rounded-2xl px-6 py-3 text-lg text-white focus:outline-none shadow-2xl"
                                                        autoFocus
                                                    />
                                                    <button onClick={(e) => saveEdit(item.id, e)} className="p-3 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-2xl transition-colors">
                                                        <Check className="w-5 h-5" />
                                                    </button>
                                                    <button onClick={cancelEdit} className="p-3 bg-white/5 text-gray-400 hover:bg-white/10 rounded-2xl transition-colors">
                                                        <X className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <h4 className="text-xl sm:text-2xl font-bold mb-3 group-hover:text-blue-400 transition-colors truncate font-display pr-6 leading-tight">
                                                        {item.title}
                                                    </h4>
                                                    <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] relative">
                                                        <span className="text-gray-400 px-3 py-1.5 rounded-xl bg-white/5 border border-white/5">{item.channel}</span>
                                                        <span className={cn(
                                                            "px-3 py-1.5 rounded-xl border",
                                                            item.type === "Summary" ? "bg-blue-500/10 border-blue-500/20 text-blue-500" : "bg-purple-500/10 border-purple-500/20 text-purple-500"
                                                        )}>
                                                            {item.type}
                                                        </span>
                                                        <span className="text-gray-600 flex items-center gap-2 ml-2">
                                                            <div className="w-1 h-1 rounded-full bg-gray-800" />
                                                            {item.date}
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-5 relative z-10 w-full sm:w-auto justify-end border-t border-white/5 sm:border-t-0 pt-6 sm:pt-0">
                                        <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                            <button
                                                onClick={(e) => startEdit(item, e)}
                                                className="p-4 text-gray-500 hover:text-white hover:bg-white/5 rounded-2xl transition-all border border-transparent"
                                                title="Rename Session"
                                            >
                                                <Edit2 className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={(e) => handleDelete(item.id, e)}
                                                className="p-4 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-2xl transition-all border border-transparent"
                                                title="Purge Analysis"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                            <div className="w-14 h-14 rounded-3xl bg-blue-600 text-white flex items-center justify-center shadow-2xl shadow-blue-600/30 group-hover:scale-105 transition-transform active:scale-95">
                                                <ArrowUpRight className="w-6 h-6" />
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
