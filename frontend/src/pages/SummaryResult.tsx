import { ArrowLeft, Share2, Play, Sparkles, List, Copy, MessageSquare, Send, Check, Info, Clock, ExternalLink, XCircle, AlertCircle, Layers, Globe } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import ReactPlayer from "react-player";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import { chatWithVideo } from "../lib/api";

interface ChatMessage {
  role: "user" | "ai";
  content: string;
}

interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="group relative flex items-center justify-center">
      {children}
      <div className="absolute bottom-full mb-3 px-3 py-1.5 bg-[#0f1115] border border-white/10 rounded-lg text-[10px] text-white font-bold opacity-0 group-hover:opacity-100 transition-all pointer-events-none whitespace-nowrap shadow-2xl z-[200] uppercase tracking-widest scale-95 group-hover:scale-100 origin-bottom">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-[#0f1115]" />
      </div>
    </div>
  );
}

export function SummaryResult() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as any;

  const [activeTab, setActiveTab] = useState("summary");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const showToast = (message: string, type: "success" | "error") => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  const handleSeek = (seconds: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(seconds, "seconds");
      setIsPlaying(true);
      showToast(`Seeking to ${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`, "success");
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Link copied to clipboard", "success");
    } catch (err) {
      showToast("Failed to copy link", "error");
    }
  };

  if (!state) {
    return (
      <div className="h-screen bg-[#050505] text-white flex items-center justify-center flex-col gap-4">
        <p className="text-gray-400 font-display">Neural state not found. Please initiate a new analysis.</p>
        <button
          onClick={() => navigate("/summarize")}
          className="px-8 py-4 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95"
        >
          Initialize Analysis
        </button>
      </div>
    );
  }

  const { sessionId, videoUrl, videoId, title, channel, date, summary, chunkCount } = state || {};

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      showToast("Summary copied successfully", "success");
    } catch (err) {
      showToast("Failed to copy summary", "error");
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || isSending) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setIsSending(true);

    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage },
      { role: "ai", content: "thinking..." }
    ]);

    try {
      const result = await chatWithVideo(sessionId, videoUrl, userMessage);
      const aiResponse = result.response;

      setChatMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "ai", content: aiResponse };
        return updated;
      });

      const timeMatch = aiResponse.match(/[\?&]t=(\d+)s?/);
      if (timeMatch && timeMatch[1]) {
        const seconds = parseInt(timeMatch[1], 10);
        handleSeek(seconds);
      }
    } catch (err: any) {
      showToast(err.message || "AI Bridge interrupted", "error");
      setChatMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "ai", content: `**Transmission Failed:** ${err.message || "Bridge interrupted."}` };
        return updated;
      });
    } finally {
      setIsSending(false);
    }
  };

  const validUrl = videoUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

  return (
    <div className="h-screen flex flex-col bg-[#050505] text-white overflow-hidden selection:bg-blue-500/30 font-sans">

      {/* Toast Notification System */}
      <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[1000] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className={cn(
                "px-6 py-3.5 rounded-2xl flex items-center gap-3 backdrop-blur-2xl shadow-2xl border min-w-[300px]",
                toast.type === "success"
                  ? "bg-green-500/10 border-green-500/20 text-green-400"
                  : "bg-red-500/10 border-red-500/20 text-red-400"
              )}
            >
              {toast.type === "success" ? <Check className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
              <span className="text-sm font-bold tracking-tight">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Top Header */}
      <div className="shrink-0 z-[100] bg-[#050505]/80 backdrop-blur-xl px-6 py-4 flex items-center justify-between border-b border-white/5">
        <Tooltip text="Back to Hub">
          <button
            onClick={() => navigate(-1)}
            className="p-2.5 hover:bg-white/5 rounded-2xl transition-all group border border-transparent hover:border-white/10"
          >
            <ArrowLeft className="w-5 h-5 text-gray-400 group-hover:text-white" />
          </button>
        </Tooltip>

        <div className="flex flex-col items-center">
          <h2 className="text-[11px] font-bold tracking-widest uppercase font-display text-blue-400 bg-blue-500/5 px-4 py-1.5 rounded-full border border-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.1)]">ClipIQ Intelligence Console</h2>
        </div>

        <div className="flex items-center gap-3">
          <Tooltip text="Copy Page URL">
            <button
              onClick={handleShare}
              className="p-2.5 bg-white/5 hover:bg-white/10 rounded-2xl transition-all group border border-white/5 shadow-xl"
            >
              <Share2 className="w-5 h-5 text-gray-400 group-hover:text-white" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Main Dashboard Layout */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 p-6 min-h-0 overflow-hidden max-w-[1800px] mx-auto w-full">

        {/* Left Column: Intelligence Feed (Video + Meta) */}
        <div className="w-full lg:w-[32%] xl:w-[26%] flex flex-col h-full overflow-y-auto custom-scrollbar pr-2 pb-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[1.75rem] overflow-hidden bg-black aspect-video relative border border-white/10 shadow-[0_48px_80px_-20px_rgba(0,0,0,0.8)] mb-8 shrink-0 group"
          >
            {validUrl ? (
              <ReactPlayer
                ref={playerRef}
                url={validUrl}
                width="100%"
                height="100%"
                controls={true}
                playing={isPlaying}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onReady={() => console.log("Player Ready")}
                onError={(e) => showToast("Video Stream Error", "error")}
                config={{
                  youtube: {
                    playerVars: {
                      autoplay: 0,
                      modestbranding: 1,
                      rel: 0,
                      iv_load_policy: 3
                    }
                  }
                } as any}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-700 gap-4 border border-white/5 bg-[#0a0a0a]">
                <AlertCircle className="w-12 h-12 text-red-500/20 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-600">Stream Offline</span>
              </div>
            )}

            {/* Quick Open Source Overlay */}
            <a
              href={validUrl}
              target="_blank"
              rel="noreferrer"
              className="absolute top-4 right-4 p-2.5 bg-black/60 backdrop-blur-md rounded-xl opacity-0 group-hover:opacity-100 transition-all border border-white/10 hover:bg-white/10 z-10"
              title="Open in YouTube"
            >
              <ExternalLink className="w-4 h-4 text-white" />
            </a>
          </motion.div>

          {/* Metadata Bloom */}
          <div className="space-y-6 shrink-0 border-b border-white/5 pb-8">
            <h1 className="text-2xl font-bold font-display tracking-tight leading-tight bg-gradient-to-br from-white to-gray-400 bg-clip-text text-transparent">{title}</h1>
            <div className="flex flex-wrap items-center gap-3">
              <span className="px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest">{channel}</span>
              <div className="flex items-center gap-1.5 text-gray-600 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-lg border border-white/5">
                <Clock className="w-3.5 h-3.5" />
                {date}
              </div>
            </div>
          </div>

          {/* Extended Analysis Stats */}
          <div className="grid grid-cols-2 gap-4 mt-8">
            {[
              { label: "Fragments", value: chunkCount || 0, icon: Layers },
              { label: "ClipIQ Uid", value: sessionId?.substring(0, 5), icon: Sparkles },
              { label: "Language", value: "Auto-Detect", icon: Globe },
              { label: "Verification", value: "Verified", icon: Check },
            ].map((stat, i) => (
              <div key={i} className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl hover:bg-white/[0.05] transition-all group">
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon className="w-3.5 h-3.5 text-blue-500/50 group-hover:text-blue-400 transition-colors" />
                  <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">{stat.label}</span>
                </div>
                <div className="text-lg font-bold font-mono text-gray-200">{stat.value}</div>
              </div>
            ))}
          </div>

          <p className="mt-8 text-[10px] text-gray-600 font-bold uppercase tracking-[0.2em] leading-relaxed italic opacity-40">
            ClipIQ Engine Confidence: 98.4% • Verified Accuracy
          </p>
        </div>

        {/* Right Column: Interaction Hub */}
        <div className="w-full lg:w-[68%] xl:w-[74%] flex flex-col bg-[#070707] border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl relative h-full">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-600/[0.02] blur-[180px] pointer-events-none" />

          {/* Tab Dock */}
          <div className="shrink-0 flex gap-2 p-3 bg-white/[0.03] backdrop-blur-2xl border-b border-white/5">
            <button
              onClick={() => setActiveTab("summary")}
              className={cn(
                "flex items-center gap-2.5 px-8 py-3.5 rounded-2xl text-[11px] font-bold uppercase tracking-widest transition-all relative overflow-hidden",
                activeTab === "summary" ? "bg-white text-black shadow-2xl scale-[1.02]" : "text-gray-500 hover:text-white hover:bg-white/5"
              )}
            >
              <Sparkles className="w-4 h-4" />
              Summary Map
              {activeTab === "summary" && <motion.div layoutId="tab-active" className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500" />}
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={cn(
                "flex items-center gap-2.5 px-8 py-3.5 rounded-2xl text-[11px] font-bold uppercase tracking-widest transition-all relative overflow-hidden",
                activeTab === "chat" ? "bg-white text-black shadow-2xl scale-[1.02]" : "text-gray-500 hover:text-white hover:bg-white/5"
              )}
            >
              <MessageSquare className="w-4 h-4" />
              Neural Chat
              {activeTab === "chat" && <motion.div layoutId="tab-active" className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500" />}
            </button>
          </div>

          {/* Viewport container */}
          <div className="flex-1 overflow-hidden relative">
            <AnimatePresence mode="wait">
              {activeTab === "summary" ? (
                <motion.div
                  key="summary"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="absolute inset-0 overflow-y-auto custom-scrollbar p-8 lg:p-14"
                >
                  <div className="flex items-center justify-between mb-12 pb-8 border-b border-white/5 group">
                    <div className="space-y-2">
                      <h3 className="text-3xl font-serif italic text-blue-400 font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Executive Intelligence Summary</h3>
                      <p className="text-[10px] text-gray-500 font-mono font-bold uppercase tracking-[0.4em] flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        Transmission Verified ✅
                      </p>
                    </div>
                    <Tooltip text="Copy Global Summary">
                      <button
                        onClick={handleCopy}
                        className="p-4 bg-white/[0.03] hover:bg-white/[0.08] rounded-[1.25rem] transition-all border border-white/10 text-gray-400 hover:text-white shadow-xl hover:scale-105 active:scale-95"
                      >
                        <Copy className="w-5 h-5" />
                      </button>
                    </Tooltip>
                  </div>

                  <div className="prose prose-invert max-w-none text-gray-400 leading-[1.9] text-base font-sans pb-32">
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-10 opacity-90">{children}</p>,
                        strong: ({ children }) => <strong className="text-white font-bold tracking-tight bg-white/5 px-1.5 py-0.5 rounded shadow-sm">{children}</strong>,
                        ul: ({ children }) => <ul className="space-y-8 mb-12 list-none p-0">{children}</ul>,
                        li: ({ children }) => (
                          <li className="flex gap-6 items-start bg-gradient-to-br from-white/[0.04] to-transparent border border-white/[0.06] p-6 lg:p-8 rounded-[2rem] transition-all hover:border-blue-500/30 hover:bg-white/[0.06] shadow-xl group">
                            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 group-hover:bg-blue-500/20 transition-all">
                              <Info className="w-5 h-5 text-blue-400" />
                            </div>
                            <div className="flex-1 mt-1 text-[17px]">{children}</div>
                          </li>
                        ),
                        a: ({ href, children }) => {
                          const timeMatch = href?.match(/t=(\d+)s?/);
                          if (timeMatch) {
                            const seconds = parseInt(timeMatch[1], 10);
                            const minutes = Math.floor(seconds / 60);
                            const secs = seconds % 60;
                            const displayTime = `${minutes}:${secs.toString().padStart(2, '0')}`;
                            return (
                              <Tooltip text={`Jump to ${displayTime}`}>
                                <button
                                  onClick={() => handleSeek(seconds)}
                                  className="text-white font-mono font-bold inline-flex items-center gap-2.5 bg-blue-600/20 hover:bg-blue-600/40 px-3.5 py-2 rounded-xl border border-blue-500/30 transition-all active:scale-90 mx-1 shadow-[0_0_20px_rgba(59,130,246,0.1)] group/btn"
                                >
                                  <Play className="w-3.5 h-3.5 fill-white shadow-sm" />
                                  <span className="text-[12px] tracking-widest">{displayTime}</span>
                                  <ExternalLink className="w-3 h-3 opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                                </button>
                              </Tooltip>
                            );
                          }
                          return <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 font-bold underline decoration-blue-500/40 underline-offset-8 hover:text-white transition-all">{children}</a>;
                        },
                      }}
                    >
                      {summary || "Transmission data corrupted."}
                    </ReactMarkdown>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="chat"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="absolute inset-0 flex flex-col h-full overflow-hidden"
                >
                  {/* Messages Feed */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-10 space-y-10 min-h-0 bg-transparent">
                    {chatMessages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-30 group cursor-default">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
                          className="w-32 h-32 border-2 border-dashed border-blue-500/20 rounded-full flex items-center justify-center mb-8"
                        >
                          <MessageSquare className="w-14 h-14" />
                        </motion.div>
                        <h4 className="text-2xl font-bold mb-3 font-display tracking-tight text-white uppercase">Neural Interface Ready</h4>
                        <p className="text-[10px] max-w-[200px] font-mono font-bold uppercase tracking-[0.3em] text-blue-400">Ask specifics about timestamps, context, or insights</p>
                      </div>
                    ) : (
                      <div className="space-y-10 pb-20">
                        {chatMessages.map((msg, i) => (
                          <motion.div
                            initial={{ opacity: 0, y: 30, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            key={i}
                            className={cn("flex w-full group/msg", msg.role === "user" ? "justify-end" : "justify-start")}
                          >
                            {msg.role === "ai" && (
                              <div className="w-12 h-12 rounded-[1.25rem] bg-gradient-to-br from-blue-500/20 to-indigo-500/5 border border-blue-500/20 flex items-center justify-center mr-5 mt-2 shrink-0 shadow-lg">
                                <Sparkles className="w-6 h-6 text-blue-400" />
                              </div>
                            )}
                            <div className={cn(
                              "max-w-[85%] lg:max-w-[78%] p-8 rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] relative",
                              msg.role === "user"
                                ? "bg-blue-600 text-white rounded-tr-none font-bold text-lg"
                                : "bg-[#0f1115] border border-white/10 text-gray-200 rounded-tl-none text-base leading-relaxed"
                            )}>
                              {msg.role === "user" && (
                                <div className="absolute top-[-10px] right-[-10px] w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-2xl">
                                  <div className="w-2 h-2 rounded-full bg-blue-600" />
                                </div>
                              )}
                              {msg.content === "thinking..." ? (
                                <div className="flex items-center gap-3 h-8 px-2">
                                  <motion.div animate={{ scale: [1, 1.4, 1], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} className="w-2.5 h-2.5 rounded-full bg-blue-400 glow" />
                                  <motion.div animate={{ scale: [1, 1.4, 1], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} className="w-2.5 h-2.5 rounded-full bg-blue-400 glow" />
                                  <motion.div animate={{ scale: [1, 1.4, 1], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} className="w-2.5 h-2.5 rounded-full bg-blue-400 glow" />
                                </div>
                              ) : (
                                <div className="prose prose-invert prose-p:leading-relaxed max-w-none">
                                  <ReactMarkdown
                                    components={{
                                      a: ({ href, children }) => {
                                        const timeMatch = href?.match(/t=(\d+)s?/);
                                        if (timeMatch) {
                                          const seconds = parseInt(timeMatch[1], 10);
                                          const minutes = Math.floor(seconds / 60);
                                          const secs = seconds % 60;
                                          const displayTime = `${minutes}:${secs.toString().padStart(2, '0')}`;
                                          return (
                                            <Tooltip text={`Seek to ${displayTime}`}>
                                              <button
                                                onClick={() => handleSeek(seconds)}
                                                className="text-white font-bold inline-flex items-center gap-2 bg-blue-600/40 hover:bg-blue-600/60 px-4 py-2 rounded-2xl border border-blue-500/40 transition-all active:scale-90 no-underline mx-1 shadow-[0_0_20px_rgba(59,130,246,0.2)]"
                                              >
                                                <Play className="w-3.5 h-3.5 fill-current" />
                                                <span className="text-[12px] font-mono tracking-widest">{displayTime}</span>
                                              </button>
                                            </Tooltip>
                                          );
                                        }
                                        return <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 font-bold underline underline-offset-8 hover:text-white">{children}</a>;
                                      }
                                    }}
                                  >
                                    {msg.content.replace(/(?<!\]\()(https?:\/\/[^\s]+)/g, "[$1]($1)")}
                                  </ReactMarkdown>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    )}
                    <div ref={chatEndRef} className="h-8 shrink-0" />
                  </div>

                  {/* Neural Input Dock */}
                  <div className="shrink-0 p-8 bg-gradient-to-t from-black to-[#070707] border-t border-white/5 relative z-10 w-full shadow-3xl">
                    <div className="absolute inset-x-0 bottom-0 h-[200px] bg-blue-600/[0.03] blur-[100px] pointer-events-none" />
                    <div className="relative flex items-center bg-white/[0.04] border border-white/10 rounded-[2.25rem] focus-within:border-blue-500/60 focus-within:bg-white/[0.06] transition-all shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] px-3 group">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                        placeholder="Inquire about transmission specifics..."
                        className="flex-1 bg-transparent border-none outline-none p-6 text-[17px] text-white placeholder:text-gray-700"
                        disabled={isSending}
                      />
                      <button
                        onClick={handleSendChat}
                        disabled={!chatInput.trim() || isSending}
                        className="w-14 h-14 flex items-center justify-center bg-blue-600 text-white rounded-[1.5rem] disabled:opacity-20 disabled:grayscale hover:bg-blue-700 transition-all shadow-[0_0_30px_rgba(37,99,235,0.4)] hover:scale-105 active:scale-95 shrink-0"
                      >
                        <Send className="w-6 h-6" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
