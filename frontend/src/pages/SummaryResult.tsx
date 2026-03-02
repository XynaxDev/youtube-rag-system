import {
  Play,
  Copy,
  Sparkles,
  MessageSquare,
  Check,
  Send,
  PlaySquare,
  Clock,
  Calendar,
  Layers,
  Fingerprint,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  User,
  ArrowLeft,
  Share2,
  XCircle,
  AlertCircle,
  Globe
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import ReactPlayer from "react-player";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import { chatWithVideo } from "../lib/api";

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  createdAt?: number;
}

interface Toast {
  id: string;
  message: string;
  type: "success" | "error";
}

/* ---------- Tooltip helpers ---------- */
function Tooltip({ text, children, align = "center" }: { text: string; children: React.ReactNode; align?: "left" | "right" | "center" }) {
  const posClass =
    align === "right" ? "right-0" :
      align === "center" ? "left-1/2 -translate-x-1/2" :
        "left-0";
  const arrowClass =
    align === "right" ? "right-4" :
      align === "center" ? "left-1/2 -translate-x-1/2" :
        "left-4";

  return (
    <div className="group relative flex items-center justify-center">
      {children}
      <div className={cn(
        "absolute bottom-full mb-3 px-3 py-1.5 bg-[#0f1115] border border-white/10 rounded-lg text-[10px] text-white font-bold opacity-0 group-hover:opacity-100 transition-all pointer-events-none shadow-2xl z-[200] uppercase tracking-widest scale-95 group-hover:scale-100 origin-bottom min-w-[100px] max-w-[200px] text-center whitespace-nowrap",
        posClass
      )}>
        {text}
        <div className={cn("absolute top-full border-[6px] border-transparent border-t-[#0f1115]", arrowClass)} />
      </div>
    </div>
  );
}

function TooltipBelow({ text, children, align = "left" }: { text: string; children: React.ReactNode; align?: "left" | "right" | "center" }) {
  const posClass =
    align === "right" ? "right-0" :
      align === "center" ? "left-1/2 -translate-x-1/2" :
        "left-0";
  const arrowClass =
    align === "right" ? "right-4" :
      align === "center" ? "left-1/2 -translate-x-1/2" :
        "left-4";

  return (
    <div className="group relative flex items-center justify-center">
      {children}
      <div className={cn(
        "absolute top-full mt-3 px-3 py-1.5 bg-[#0f1115] border border-white/10 rounded-lg text-[10px] text-white font-bold opacity-0 group-hover:opacity-100 transition-all pointer-events-none shadow-2xl z-[200] uppercase tracking-widest scale-95 group-hover:scale-100 origin-top min-w-[100px] max-w-[200px] text-center whitespace-nowrap",
        posClass
      )}>
        {text}
        <div className={cn("absolute bottom-full border-[6px] border-transparent border-b-[#0f1115]", arrowClass)} />
      </div>
    </div>
  );
}

/* Hide scrollbar utility — added via inline style */
const hideScrollbar: React.CSSProperties = {
  scrollbarWidth: "none",           /* Firefox */
  msOverflowStyle: "none",          /* IE/Edge */
};
const hideScrollbarCSS = `
  .hide-scrollbar::-webkit-scrollbar { display: none; }
  .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  .scrollbar-hide::-webkit-scrollbar { display: none; }
  .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
`;
const makeMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function SummaryResult() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as any;

  const [activeTab, setActiveTab] = useState<"summary" | "chat">("summary");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const mobileChatEndRef = useRef<HTMLDivElement>(null);
  const desktopChatEndRef = useRef<HTMLDivElement>(null);
  const mobileChatScrollRef = useRef<HTMLDivElement>(null);
  const desktopChatScrollRef = useRef<HTMLDivElement>(null);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const formatClockTime = (timestamp?: number) => {
    if (!timestamp) return "";
    const time = new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return time.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  };

  const extractTimestamps = (content: string) => {
    const matches = Array.from(content.matchAll(/t=(\d+)s?/g));
    return [...new Set(matches.map(m => parseInt(m[1], 10)))];
  };

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

  // Use internal scroll instead of window scroll to prevent "page jump"
  useEffect(() => {
    if (activeTab !== "chat") return;
    const activeChatScroller = isDesktop
      ? desktopChatScrollRef.current
      : mobileChatScrollRef.current;
    if (activeChatScroller) {
      activeChatScroller.scrollTo({
        top: activeChatScroller.scrollHeight,
        behavior: "smooth" // Changed back to smooth after testing auto
      });
    }
  }, [chatMessages, activeTab, isDesktop]);

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
        <p className="text-gray-400 font-display text-sm tracking-widest uppercase">Intelligence state not found. Please initiate a new analysis.</p>
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

  const handleSendChat = async (overrideMessage?: string) => {
    const userMessage = (overrideMessage ?? chatInput).trim();
    if (!userMessage || isSending) return;

    const userMsgId = makeMessageId();
    const aiMsgId = makeMessageId();
    setChatInput("");
    setIsSending(true);

    setChatMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: userMessage, createdAt: Date.now() },
      { id: aiMsgId, role: "ai", content: "thinking...", createdAt: Date.now() }
    ]);

    try {
      const result = await chatWithVideo(sessionId, videoUrl, userMessage);
      const aiResponse = result.response;

      setChatMessages((prev) => {
        return prev.map((msg) =>
          msg.id === aiMsgId
            ? { ...msg, content: aiResponse, createdAt: Date.now() }
            : msg
        );
      });

      // AUTO-SEEK DETECTION: Look for the first timestamp in the response
      const timeMatch = aiResponse.match(/[\?&]t=(\d+)s?/);
      if (timeMatch && timeMatch[1]) {
        const seconds = parseInt(timeMatch[1], 10);
        // Force seek immediately for better UX
        if (playerRef.current) {
          playerRef.current.seekTo(seconds, 'seconds');
          setIsPlaying(true);
        }
      }
    } catch (err: any) {
      showToast(err.message || "AI Bridge interrupted", "error");
      setChatMessages((prev) => {
        return prev.map((msg) =>
          msg.id === aiMsgId
            ? {
              ...msg,
              content: `**Transmission Failed:** ${err.message || "Bridge interrupted."}`,
              createdAt: Date.now(),
            }
            : msg
        );
      });
    } finally {
      setIsSending(false);
    }
  };



  const validUrl = videoUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

  return (
    <>
      {/* Inject hide-scrollbar helper */}
      <style>{hideScrollbarCSS}</style>

      <div className="w-full h-full flex flex-col bg-[#050505] text-white selection:bg-blue-500/30 font-sans relative pb-[72px] lg:pb-0 overflow-x-hidden">

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

        {/* Top Header (Sticky) */}
        <div className="sticky top-0 z-[150] shrink-0 bg-[#050505]/80 backdrop-blur-xl px-4 md:px-6 py-3 md:py-4 flex items-center justify-between border-b border-white/5">
          {/* Back — align left but with a small offset to ensure it's not touching the screen edge */}
          <TooltipBelow text="Back to Hub" align="left">
            <button
              onClick={() => navigate(-1)}
              className="p-2 md:p-2.5 hover:bg-white/5 rounded-2xl transition-all group border border-transparent hover:border-white/10"
            >
              <ArrowLeft className="w-5 h-5 text-gray-400 group-hover:text-white" />
            </button>
          </TooltipBelow>

          <div className="flex flex-col items-center">
            <h2 className="text-[11px] font-bold tracking-widest uppercase font-display text-blue-400 bg-blue-500/5 px-4 py-1.5 rounded-full border border-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.1)]">ClipIQ Platform Console</h2>
          </div>

          {/* Share — tooltip grows LEFT (right-0) so it never clips right edge */}
          <div className="flex items-center gap-3">
            <TooltipBelow text="Copy Page URL" align="right">
              <button
                onClick={handleShare}
                className="p-2.5 bg-white/5 hover:bg-white/10 rounded-2xl transition-all group border border-white/5 shadow-xl"
              >
                <Share2 className="w-5 h-5 text-gray-400 group-hover:text-white" />
              </button>
            </TooltipBelow>
          </div>
        </div>

        {/* ─── Main Dashboard ─── */}
        {/* On desktop (lg): side-by-side, both columns fill height, no page scroll.
            On mobile: vertical stack, the whole thing scrolls. */}
        {/* Dash Container: Fixed Viewport Mode */}
        <div
          className="flex-1 flex flex-col lg:flex-row gap-4 md:gap-6 p-4 md:p-6 lg:p-10 max-w-[1800px] mx-auto w-full relative mt-4 lg:mt-0"
          style={{ minHeight: 0 }}
        >
          {/* ─── MOBILE: stack vertically, video first ─── */}
          <div className="lg:hidden flex flex-col gap-4 px-4 py-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl overflow-hidden bg-black aspect-video relative border border-white/10 shadow-xl shrink-0 group"
            >
              {validUrl ? (
                !isDesktop && (
                  <ReactPlayer
                    key={validUrl}
                    ref={playerRef}
                    url={validUrl}
                    width="100%"
                    height="100%"
                    controls={true}
                    playing={isPlaying}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    config={{ youtube: { playerVars: { modestbranding: 1, rel: 0 } } }}
                  />
                )
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center"><Play className="w-5 h-5 text-gray-600" /></div>
                </div>
              )}
            </motion.div>

            {/* Video Meta */}
            <div className="space-y-2">
              {title && <h1 className="font-bold text-base leading-snug text-white">{title}</h1>}
              {channel && (
                <span className="inline-block text-[9px] font-bold uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full">{channel}</span>
              )}
            </div>

            {/* Tab Switcher - Sticky at Top (Under Header) on Mobile */}
            <div className="sticky top-[58px] z-[120] -mx-4 px-4 py-3 bg-[#050505]/90 backdrop-blur-xl shadow-xl">
              <div className="flex gap-2 bg-white/[0.04] border border-white/10 p-1 rounded-2xl">
                <button
                  onClick={() => setActiveTab("summary")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    activeTab === "summary" ? "bg-blue-600 border border-blue-500/40 text-white shadow-[0_0_20px_rgba(37,99,235,0.2)]" : "text-gray-400 hover:text-white"
                  )}
                >
                  <Sparkles className={cn("w-3.5 h-3.5", activeTab === "summary" ? "text-blue-100" : "text-gray-500")} />
                  Summary
                </button>
                <button
                  onClick={() => setActiveTab("chat")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    activeTab === "chat" ? "bg-blue-600 border border-blue-500/40 text-white shadow-[0_0_20px_rgba(37,99,235,0.2)]" : "text-gray-400 hover:text-white"
                  )}
                >
                  <MessageSquare className={cn("w-3.5 h-3.5", activeTab === "chat" ? "text-blue-100" : "text-gray-500")} />
                  Chat
                </button>
              </div>
            </div>

            {/* Tab Content - natural height for summary, fixed for chat */}
            {activeTab === "summary" ? (
              <div className="bg-[#0f1115] rounded-2xl border border-white/5 p-4">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                  <div>
                    <h3 className="text-sm font-serif italic text-blue-400 font-bold">Executive Intelligence Summary</h3>
                    <div className="text-[9px] text-gray-500 font-mono font-bold uppercase tracking-widest flex items-center gap-2 mt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Transmission Verified <Check className="w-3 h-3 text-green-500" />
                    </div>
                  </div>
                  <button onClick={handleCopy} className="p-2.5 bg-white/[0.03] hover:bg-white/[0.08] rounded-xl border border-white/10 text-gray-400">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <div className="prose prose-invert prose-sm max-w-none pb-14 text-sans leading-relaxed text-[14px]">
                  <ReactMarkdown
                    components={{
                      h1: ({ children }) => <h1 className="text-white font-bold text-xl mt-6 mb-3 font-serif">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-white font-bold text-lg mt-5 mb-2 font-serif">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-blue-300 font-bold text-base mt-4 mb-2 font-serif italic">{children}</h3>,
                      p: ({ children }) => <p className="mb-4 text-gray-300 leading-relaxed">{children}</p>,
                      strong: ({ children }) => <strong className="text-white font-bold">{children}</strong>,
                      ul: ({ children }) => <ul className="mb-6 list-none p-0 space-y-2">{children}</ul>,
                      ol: ({ children }) => <ol className="mb-6 list-none p-0 space-y-2">{children}</ol>,
                      li: ({ children }) => {
                        const isHeader = typeof children === 'string' && (children.startsWith('Key Takeaways') || children.startsWith('Summary'));
                        return (
                          <li className={cn("flex gap-3 items-start", isHeader && "mt-6 mb-3")}>
                            {!isHeader && <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-1" />}
                            <span className={cn(
                              "leading-relaxed text-gray-300",
                              isHeader && "text-white font-bold text-lg font-serif italic"
                            )}>{children}</span>
                          </li>
                        );
                      },
                      a: ({ href, children }) => {
                        const timeMatch = href?.match(/t=(\d+)s?/);
                        if (timeMatch) {
                          const seconds = parseInt(timeMatch[1], 10);
                          const minutes = Math.floor(seconds / 60);
                          const secs = seconds % 60;
                          const displayTime = `${minutes}:${secs.toString().padStart(2, '0')}`;
                          return (
                            <button onClick={() => handleSeek(seconds)} className="text-white font-mono font-bold inline-flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/40 px-2py-1 rounded-lg border border-blue-500/30 transition-all text-[11px] mx-1">
                              <Play className="w-3 h-3 fill-white" /><span>{displayTime}</span>
                            </button>
                          );
                        }
                        return <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 font-bold underline decoration-blue-500/40 underline-offset-4 hover:text-white transition-all">{children}</a>;
                      },
                    }}
                  >
                    {summary || "Transmission data corrupted."}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              /* Chat: fixed tall container so input is always visible */
              <div
                className="bg-[#070707] rounded-3xl border border-white/5 flex flex-col overflow-hidden relative"
                style={{ height: isDesktop ? 'auto' : 'calc(100vh - 400px)', minHeight: '400px', touchAction: "pan-y" }}
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/[0.05] blur-[50px] pointer-events-none" />
                {/* Messages scroll area */}
                <div
                  ref={mobileChatScrollRef}
                  data-lenis-prevent
                  className="flex-1 min-h-0 overflow-y-scroll overscroll-y-contain p-4 md:p-6 space-y-6 custom-scrollbar flex flex-col"
                  style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
                >
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-10 opacity-40">
                      <MessageSquare className="w-10 h-10 mb-4 text-blue-500/30" />
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600">Equipped & Ready</p>
                      <div className="flex flex-wrap gap-2 mt-4 justify-center">
                        {["Summarize this", "Key points", "Conclusion"].map((q) => (
                          <button key={q} onClick={() => handleSendChat(q)}
                            className="px-4 py-2 bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 rounded-full active:scale-95">{q}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-8 pb-6">
                      {chatMessages.map((msg) => (
                        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} key={msg.id}
                          className={cn("flex w-full group/msg", msg.role === "user" ? "justify-end" : "justify-start")}>
                          {msg.role === "ai" && (
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/5 border border-white/10 flex items-center justify-center mr-3 mt-1 shrink-0 shadow-lg">
                              <Sparkles className="w-4 h-4 text-blue-400" />
                            </div>
                          )}
                          <div className={cn("flex flex-col max-w-[92%] min-w-0 gap-2", msg.role === "user" ? "items-end ml-auto" : "items-start")}>
                            <div className={cn(
                              "px-5 py-4 rounded-[1.25rem] shadow-xl relative transition-all w-fit min-w-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
                              msg.role === "user"
                                ? "bg-blue-600 text-white rounded-tr-none font-medium text-[14px]"
                                : "bg-[#111113] border border-white/10 text-gray-200 rounded-tl-none text-[14px] leading-relaxed"
                            )}>
                              {msg.content === "thinking..." ? (
                                <div className="flex items-center gap-1.5 h-4 px-1">
                                  <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} className="w-1 h-1 rounded-full bg-blue-400" />
                                  <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} className="w-1 h-1 rounded-full bg-blue-400" />
                                  <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} className="w-1 h-1 rounded-full bg-blue-400" />
                                </div>
                              ) : (
                                <div className="prose prose-invert prose-sm max-w-none">
                                  <ReactMarkdown
                                    components={{
                                      p: ({ children }) => <p className="m-0">{children}</p>,
                                      ul: ({ children }) => <ul className="m-0 list-none p-0 space-y-1.5">{children}</ul>,
                                      li: ({ children }) => {
                                        const text = Array.isArray(children)
                                          ? children.map(c => typeof c === 'string' ? c : '').join('')
                                          : typeof children === 'string' ? children : '';

                                        const isSummary = text.toLowerCase().startsWith('summary:');
                                        const isTakeaways = text.toLowerCase().startsWith('key takeaways:');

                                        if (isSummary || isTakeaways) {
                                          return (
                                            <li className="mt-8 mb-6 list-none first:mt-0">
                                              <div className="flex items-center gap-3">
                                                <div className="h-px flex-1 bg-gradient-to-r from-blue-500/50 to-transparent" />
                                                <span className="shrink-0 inline-flex items-center gap-2 px-3 py-1 bg-blue-600/10 border border-blue-500/20 rounded-lg text-blue-400 font-bold text-[10px] uppercase tracking-widest font-serif italic backdrop-blur-sm shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                                                  <Sparkles className="w-3.5 h-3.5" />
                                                  {text}
                                                </span>
                                                <div className="h-px flex-1 bg-gradient-to-l from-blue-500/50 to-transparent" />
                                              </div>
                                            </li>
                                          );
                                        }

                                        return (
                                          <li className="flex gap-2.5 items-start mb-3 last:mb-0">
                                            <Sparkles className="w-3.5 h-3.5 text-blue-500/40 shrink-0 mt-1" />
                                            <span className="text-[13px] leading-relaxed text-gray-300">{children}</span>
                                          </li>
                                        );
                                      },
                                      a: ({ href, children }) => {
                                        const timeMatch = href?.match(/t=(\d+)s?/);
                                        return (
                                          <span
                                            onClick={() => timeMatch && handleSeek(parseInt(timeMatch[1], 10))}
                                            className="text-blue-400 font-bold underline decoration-blue-500/40 underline-offset-4 cursor-pointer"
                                          >
                                            {children}
                                          </span>
                                        );
                                      }
                                    }}
                                  >
                                    {msg.content
                                      .replace(/\[https?:\/\/youtu\.be\/[^\s\]]+\]/g, "")
                                      .replace(/https?:\/\/youtu\.be\/[^\s\]]+/g, "")
                                      .replace(/(?<!\]\()(https?:\/\/[^\s]+)/g, "[$1]($1)")}
                                  </ReactMarkdown>
                                </div>
                              )}
                            </div>
                            {msg.role === "ai" && msg.content !== "thinking..." && (
                              <div className="flex items-center gap-2 mt-2 ml-1">
                                <Tooltip text="Copy response" align="left">
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(msg.content);
                                      showToast("Copied", "success");
                                    }}
                                    className="p-1.5 text-gray-500 hover:text-white transition-colors"
                                  >
                                    <Copy className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                  </button>
                                </Tooltip>
                                <div className="h-3 w-px bg-white/10 mx-px" />
                                <span className="text-[10px] font-mono font-bold tracking-wide text-gray-400">{formatClockTime(msg.createdAt)}</span>
                                {extractTimestamps(msg.content).length > 0 && (
                                  <>
                                    <div className="h-3 w-px bg-white/10 mx-px" />
                                    <div className="flex flex-wrap gap-1.5">
                                      {extractTimestamps(msg.content).map((seconds, idx) => {
                                        const mins = Math.floor(seconds / 60);
                                        const s = seconds % 60;
                                        const timeStr = `${mins}:${s.toString().padStart(2, '0')}`;
                                        return (
                                          <button
                                            key={idx}
                                            onClick={() => handleSeek(seconds)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600/10 border border-blue-500/20 rounded-lg text-blue-400 font-mono text-[10px] font-bold hover:bg-blue-600/20 active:scale-95 transition-all"
                                          >
                                            <Play className="w-2.5 h-2.5 fill-current" />
                                            {timeStr}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          {
                            msg.role === "user" && (
                              <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center ml-3 mt-1 shrink-0 shadow-lg">
                                <User className="w-4 h-4 text-blue-400" />
                              </div>
                            )
                          }
                        </motion.div>
                      ))}
                      <div ref={mobileChatEndRef} />
                    </div>
                  )}
                </div>
                {/* Chat Input - always visible at bottom */}
                <div className="shrink-0 p-3 md:p-4 bg-transparent">
                  <div className="w-full mx-auto relative flex items-end gap-2 bg-white/[0.04] border border-white/10 rounded-[1.25rem] px-3 focus-within:border-blue-500/40 transition-all shadow-inner p-1.5">
                    <textarea
                      data-lenis-prevent
                      value={chatInput}
                      onChange={(e) => {
                        setChatInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendChat();
                          (e.target as HTMLTextAreaElement).style.height = 'auto';
                        }
                      }}
                      placeholder="Ask anything..."
                      rows={1}
                      className="flex-1 bg-transparent border-none outline-none py-2 text-[14px] leading-relaxed text-white placeholder:text-gray-700 focus:ring-0 resize-none max-h-[100px] overflow-y-auto touch-auto"
                      disabled={isSending}
                    />
                    <button onClick={handleSendChat} disabled={!chatInput.trim() || isSending}
                      className="w-8 h-8 flex items-center justify-center bg-blue-600/80 text-white rounded-full disabled:opacity-20 active:scale-95 shrink-0 shadow-lg mb-0.5">
                      <Send className="w-3.5 h-3.5 fill-white text-white" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── DESKTOP: side-by-side columns (lg+) ─── */}
          <div className="hidden lg:contents">
            {/* Left Column (Video/Meta) */}
            <div className="lg:w-[32%] xl:w-[26%] flex flex-col overflow-y-auto overflow-x-hidden scrollbar-hide pb-6 shrink-0 lg:pr-2 overscroll-contain">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-[1.25rem] md:rounded-[1.75rem] overflow-hidden bg-black aspect-video relative border border-white/10 shadow-[0_48px_80px_-20px_rgba(0,0,0,0.8)] mb-6 md:mb-8 shrink-0 group"
              >
                {validUrl ? (
                  isDesktop && (
                    <ReactPlayer
                      key={validUrl}
                      ref={playerRef}
                      url={validUrl}
                      width="100%"
                      height="100%"
                      controls={true}
                      playing={isPlaying}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onReady={() => console.log("Player Ready")}
                      onError={(e) => {
                        console.error("Player Error:", e);
                        showToast("Video stream unavailable", "error");
                      }}
                      config={{
                        youtube: {
                          playerVars: {
                            autoplay: 0,
                            modestbranding: 1,
                            rel: 0,
                            iv_load_policy: 3,
                            origin: window.location.origin
                          }
                        }
                      } as any}
                    />
                  )
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-700 gap-4 border border-white/5 bg-[#0a0a0a]">
                    <AlertCircle className="w-12 h-12 text-red-500/20 animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-600">Stream Offline</span>
                  </div>
                )}

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

              {/* Metadata */}
              <div className="space-y-4 md:space-y-6 shrink-0 pb-6 md:pb-8">
                <h1 className="text-xl md:text-2xl font-bold font-display tracking-tight leading-tight bg-gradient-to-br from-white to-gray-400 bg-clip-text text-transparent">{title}</h1>
                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                  <span className="px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[9px] md:text-[10px] font-bold uppercase tracking-widest">{channel}</span>
                  <div className="flex items-center gap-1.5 text-gray-600 text-[9px] md:text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-lg border border-white/5">
                    <Clock className="w-3 md:w-3.5 h-3 md:h-3.5" />
                    {date}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 md:gap-4 shrink-0">
                {[
                  { label: "Fragments", value: chunkCount || 0, icon: Layers },
                  { label: "ClipIQ Uid", value: sessionId?.substring(0, 5), icon: Sparkles },
                  { label: "Language", value: "Auto-Detect", icon: Globe },
                  { label: "Verification", value: "Verified", icon: Check },
                ].map((stat, i) => (
                  <div key={i} className="p-3 md:p-4 bg-white/[0.03] border border-white/5 rounded-2xl hover:bg-white/[0.05] transition-all group">
                    <div className="flex items-center gap-2 mb-1.5 md:mb-2 text-blue-500/50 group-hover:text-blue-400 transition-colors">
                      <stat.icon className="w-3 md:w-3.5 h-3 md:h-3.5" />
                      <span className="text-[8px] md:text-[9px] text-gray-500 font-bold uppercase tracking-widest">{stat.label}</span>
                    </div>
                    <div className="text-base md:text-lg font-bold font-mono text-gray-200">{stat.value}</div>
                  </div>
                ))}
              </div>

              <p className="mt-6 text-[10px] text-gray-600 font-bold uppercase tracking-[0.2em] leading-relaxed italic opacity-40">
                ClipIQ Engine Confidence: 98.4% • Verified Accuracy
              </p>
            </div>

            {/* ─── Right Column: Summary / Chat Hub ─── */}
            <div className="flex-1 flex flex-col bg-[#070707] rounded-[2rem] border border-white/5 shadow-[0_40px_100px_rgba(0,0,0,0.6)] relative min-h-0 overflow-hidden">
              <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-600/[0.02] blur-[180px] pointer-events-none" />

              {/* Tab Dock */}
              <div className="shrink-0 flex gap-2 p-2 md:p-3 bg-white/[0.03] backdrop-blur-2xl overflow-x-auto hide-scrollbar">
                <button
                  onClick={() => setActiveTab("summary")}
                  className={cn(
                    "flex items-center gap-2.5 px-6 md:px-8 py-3 md:py-3.5 rounded-xl md:rounded-2xl text-[10px] md:text-[11px] font-bold uppercase tracking-widest transition-all whitespace-nowrap relative group",
                    activeTab === "summary" ? "text-white" : "text-gray-500 hover:text-white"
                  )}
                >
                  <Sparkles className={cn("w-3.5 md:w-4 h-3.5 md:h-4", activeTab === "summary" ? "text-blue-400" : "text-gray-600")} />
                  Summary Map
                  {activeTab === "summary" && (
                    <motion.div
                      layoutId="activeTabDesktop"
                      initial={false}
                      className="absolute inset-0 bg-blue-500/10 border border-blue-500/30 rounded-xl md:rounded-2xl -z-10 shadow-[0_0_25px_rgba(59,130,246,0.15)]"
                    />
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("chat")}
                  className={cn(
                    "flex items-center gap-2.5 px-6 md:px-8 py-3 md:py-3.5 rounded-xl md:rounded-2xl text-[10px] md:text-[11px] font-bold uppercase tracking-widest transition-all whitespace-nowrap relative group",
                    activeTab === "chat" ? "text-white" : "text-gray-500 hover:text-white"
                  )}
                >
                  <MessageSquare className={cn("w-3.5 md:w-4 h-3.5 md:h-4", activeTab === "chat" ? "text-blue-400" : "text-gray-600")} />
                  ClipIQ Chat
                  {activeTab === "chat" && (
                    <motion.div
                      layoutId="activeTabDesktop"
                      initial={false}
                      className="absolute inset-0 bg-blue-500/10 border border-blue-500/30 rounded-xl md:rounded-2xl -z-10 shadow-[0_0_25px_rgba(59,130,246,0.15)]"
                    />
                  )}
                </button>
              </div>

              {/* ─── Tab Content ─── */}
              {/* overflow-hidden here is only for desktop lg */}
              <div className="flex-1 relative min-h-0 flex flex-col">
                <AnimatePresence mode="wait">
                  {activeTab === "summary" ? (
                    <motion.div
                      key="summary"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar overscroll-contain"
                    >
                      <div className="p-5 md:p-8 lg:p-14 w-full">
                        <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/5">
                          <div className="flex flex-col gap-1.5">
                            <h3 className="text-lg md:text-2xl font-serif italic text-blue-400 font-bold tracking-tight">Executive Intelligence Summary</h3>
                            <div className="text-[8px] md:text-[9px] text-gray-500 font-mono font-bold uppercase tracking-[0.4em] flex items-center gap-2">
                              <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                              Data Link Established
                              <Check className="w-2.5 h-2.5 text-green-500" />
                            </div>
                          </div>
                          <Tooltip text="Copy Summary" align="right">
                            <button
                              onClick={handleCopy}
                              className="p-3 bg-white/[0.03] hover:bg-white/[0.08] rounded-xl transition-all border border-white/10 text-gray-400 hover:text-white shadow-xl hover:scale-105 active:scale-95"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        </div>

                        <div className="prose prose-invert max-w-none font-sans pb-20">
                          <ReactMarkdown
                            components={{
                              h1: ({ children }) => <h1 className="text-white font-bold text-xl md:text-2xl mt-8 mb-3 font-serif">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-white font-bold text-lg md:text-xl mt-6 mb-3 font-serif">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-blue-300 font-bold text-base md:text-lg mt-5 mb-2 font-serif italic">{children}</h3>,
                              p: ({ children }) => <p className="mb-4 text-gray-300 text-[14px] md:text-[15px] leading-[1.8]">{children}</p>,
                              strong: ({ children }) => <strong className="text-white font-bold">{children}</strong>,
                              ul: ({ children }) => <ul className="mb-6 list-none p-0 space-y-2">{children}</ul>,
                              li: ({ children }) => {
                                const text = Array.isArray(children)
                                  ? children.map(c => typeof c === 'string' ? c : '').join('')
                                  : typeof children === 'string' ? children : '';

                                const isHeader = /^(summary|key takeaways):/i.test(text.trim());

                                return (
                                  <li className={cn("flex gap-3 items-start", isHeader ? "mt-12 mb-6 block w-full" : "mb-3")}>
                                    {!isHeader && <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-1.5" />}
                                    <span className={cn(
                                      "text-[14px] md:text-[15px] leading-relaxed text-gray-300",
                                      isHeader && "text-white font-bold text-xl md:text-2xl font-serif italic block border-l-4 border-blue-500 pl-5 py-2 bg-white/[0.02] rounded-r-xl"
                                    )}>{children}</span>
                                  </li>
                                );
                              },
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
                                        className="text-white font-mono font-bold inline-flex items-center gap-2 bg-blue-600/20 hover:bg-blue-600/40 px-3 py-1.5 rounded-lg border border-blue-500/30 transition-all active:scale-90 mx-1 text-[12px]"
                                      >
                                        <Play className="w-3 h-3 fill-white" />
                                        <span>{displayTime}</span>
                                      </button>
                                    </Tooltip>
                                  );
                                }
                                return <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 font-bold underline decoration-blue-500/40 underline-offset-4 hover:text-white transition-all">{children}</a>;
                              },
                            }}
                          >
                            {summary || "Transmission data corrupted."}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="chat"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="flex-1 flex flex-col min-h-0 overflow-hidden"
                      style={{ touchAction: "pan-y" }}
                    >
                      <div
                        ref={desktopChatScrollRef}
                        data-lenis-prevent
                        className="flex-1 overflow-y-scroll overflow-x-hidden overscroll-y-contain custom-scrollbar p-5 md:p-6 lg:p-12 space-y-10 md:space-y-12 flex flex-col"
                        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
                      >
                        {chatMessages.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-30 cursor-default">
                            <MessageSquare className="w-16 h-16 mb-6 text-blue-500/20" />
                            <h4 className="text-xl font-bold mb-3 font-display tracking-widest text-white uppercase">ClipIQ Interface Ready</h4>
                            <p className="text-[10px] max-w-[250px] font-bold uppercase tracking-[0.3em] text-gray-600 mb-8">Ask about specific timestamps, context, or hidden insights</p>

                            <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg px-4">
                              {[
                                "Give me a direct summary.",
                                "What are the main arguments?",
                                "Explain the conclusion.",
                                "What's the best takeaway?"
                              ].map((q) => (
                                <button
                                  key={q}
                                  onClick={() => handleSendChat(q)}
                                  className="px-4 py-2 bg-white/5 hover:bg-blue-600/20 border border-white/10 hover:border-blue-500 text-[10px] md:text-xs font-bold text-gray-400 hover:text-white rounded-full transition-all active:scale-95"
                                >
                                  {q}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-10 pb-20">
                            {chatMessages.map((msg) => (
                              <motion.div
                                initial={{ opacity: 0, y: 30, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                key={msg.id}
                                className={cn("flex w-full group/msg", msg.role === "user" ? "justify-end" : "justify-start")}
                              >
                                {msg.role === "user" ? (
                                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center ml-4 md:ml-5 mt-1 shrink-0 shadow-lg order-2 group-hover/msg:border-blue-500/40 transition-colors">
                                    <User className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
                                  </div>
                                ) : (
                                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/5 border border-white/10 flex items-center justify-center mr-4 md:mr-5 mt-1 shrink-0 shadow-lg group-hover/msg:border-blue-500/40 transition-colors">
                                    <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
                                  </div>
                                )}
                                <div className={cn(
                                  "flex flex-col max-w-[90%] lg:max-w-[85%] min-w-0 gap-2 w-fit",
                                  msg.role === "user" ? "items-end" : "items-start"
                                )}>
                                  <div className={cn(
                                    "px-5 py-4 rounded-[1.5rem] md:rounded-[2rem] shadow-xl relative transition-all w-fit min-w-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
                                    msg.role === "user"
                                      ? "bg-blue-600 text-white rounded-tr-none font-medium text-[13px] md:text-[14px]"
                                      : "bg-[#0f1115] border border-white/10 text-gray-300 rounded-tl-none text-[13px] md:text-[14px] leading-relaxed"
                                  )}>
                                    {msg.content === "thinking..." ? (
                                      <div className="flex items-center gap-1 md:gap-1.5 h-4 px-1">
                                        <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} className="w-0.5 md:w-1 h-0.5 md:h-1 rounded-full bg-blue-400" />
                                        <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} className="w-0.5 md:w-1 h-0.5 md:h-1 rounded-full bg-blue-400" />
                                        <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} className="w-0.5 md:w-1 h-0.5 md:h-1 rounded-full bg-blue-400" />
                                      </div>
                                    ) : (
                                      <div className="prose prose-invert max-w-none">
                                        <ReactMarkdown
                                          components={{
                                            h1: ({ children }) => <h1 className="text-white font-bold text-lg md:text-xl mt-4 mb-2 font-serif">{children}</h1>,
                                            h2: ({ children }) => <h2 className="text-white font-bold text-md md:text-lg mt-3 mb-2 font-serif">{children}</h2>,
                                            h3: ({ children }) => <h3 className="text-blue-300 font-bold text-sm md:text-md mt-3 mb-1 font-serif italic">{children}</h3>,
                                            p: ({ children }) => <p className="m-0 text-gray-300 text-[13px] md:text-[14px] leading-relaxed">{children}</p>,
                                            strong: ({ children }) => <strong className="text-white font-bold">{children}</strong>,
                                            ul: ({ children }) => <ul className="m-0 list-none p-0 space-y-2">{children}</ul>,
                                            ol: ({ children }) => <ol className="m-0 list-none p-0 space-y-2">{children}</ol>,
                                            li: ({ children }) => {
                                              const text = Array.isArray(children)
                                                ? children.map(c => typeof c === 'string' ? c : '').join('')
                                                : typeof children === 'string' ? children : '';

                                              const isSummary = text.toLowerCase().startsWith('summary:');
                                              const isTakeaways = text.toLowerCase().startsWith('key takeaways:');

                                              if (isSummary || isTakeaways) {
                                                return (
                                                  <li className="mt-8 mb-6 list-none first:mt-0">
                                                    <div className="flex items-center gap-3">
                                                      <div className="h-px flex-1 bg-gradient-to-r from-blue-500/50 to-transparent" />
                                                      <span className="shrink-0 inline-flex items-center gap-2.5 px-4 py-1.5 bg-blue-600/10 border border-blue-500/40 rounded-xl text-blue-400 font-bold text-[12px] md:text-xs uppercase tracking-[0.2em] shadow-[0_0_30px_rgba(59,130,246,0.1)] font-serif italic backdrop-blur-sm">
                                                        <Sparkles className="w-4 h-4 text-blue-400" />
                                                        {text}
                                                      </span>
                                                      <div className="h-px flex-1 bg-gradient-to-l from-blue-500/50 to-transparent" />
                                                    </div>
                                                  </li>
                                                );
                                              }

                                              return (
                                                <li className="flex gap-3.5 items-start mb-4 last:mb-0 group/li">
                                                  <Sparkles className="w-3 md:w-3.5 h-3 md:h-3.5 text-blue-500/40 shrink-0 mt-1.5 transition-all group-hover/li:text-blue-400" />
                                                  <span className="text-[13px] md:text-[14px] leading-relaxed text-gray-300 transition-colors group-hover/li:text-white">
                                                    {children}
                                                  </span>
                                                </li>
                                              );
                                            },
                                            a: ({ href, children }) => {
                                              const timeMatch = href?.match(/t=(\d+)s?/);
                                              return (
                                                <span
                                                  onClick={() => timeMatch && handleSeek(parseInt(timeMatch[1], 10))}
                                                  className="text-blue-400 font-bold underline underline-offset-8 hover:text-white transition-all cursor-pointer"
                                                >
                                                  {children}
                                                </span>
                                              );
                                            }
                                          }}
                                        >
                                          {msg.content
                                            .replace(/Source(?:\s*link)?:\s*/gi, "")
                                            .replace(/\[https?:\/\/youtu\.be\/[^\s\]]+\]/g, "")
                                            .replace(/https?:\/\/youtu\.be\/[^\s\]]+/g, "")
                                            .replace(/(?<!\]\()(https?:\/\/[^\s]+)/g, "[$1]($1)")}
                                        </ReactMarkdown>
                                      </div>
                                    )}
                                    {msg.role === "ai" && msg.content !== "thinking..." && (
                                      <div className="flex items-center gap-3 mt-2.5 ml-1">
                                        <Tooltip text="Copy response" align="left">
                                          <button
                                            onClick={() => {
                                              navigator.clipboard.writeText(msg.content);
                                              showToast("Copied to clipboard", "success");
                                            }}
                                            className="p-1.5 text-gray-500 hover:text-white transition-colors"
                                          >
                                            <Copy className="w-3.5 h-3.5" />
                                          </button>
                                        </Tooltip>
                                        <div className="h-3 w-px bg-white/10 mx-px" />
                                        <span className="text-[10px] font-mono font-bold tracking-wide text-gray-400">{formatClockTime(msg.createdAt)}</span>
                                        {extractTimestamps(msg.content).length > 0 && (
                                          <>
                                            <div className="h-3 w-px bg-white/10 mx-px" />
                                            <div className="flex flex-wrap gap-2">
                                              {extractTimestamps(msg.content).map((seconds, idx) => {
                                                const mins = Math.floor(seconds / 60);
                                                const s = seconds % 60;
                                                const timeStr = `${mins}:${s.toString().padStart(2, '0')}`;
                                                return (
                                                  <Tooltip key={idx} text={`Seek to ${timeStr}`} align="left">
                                                    <button
                                                      onClick={() => handleSeek(seconds)}
                                                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-600/10 border border-blue-500/30 rounded-lg text-blue-400 font-mono text-[10px] font-bold hover:bg-blue-600/20 active:scale-95 transition-all shadow-sm"
                                                    >
                                                      <Play className="w-2.5 h-2.5 fill-current" />
                                                      {timeStr}
                                                    </button>
                                                  </Tooltip>
                                                );
                                              })}
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        )}
                        <div ref={desktopChatEndRef} className="h-4 md:h-8 shrink-0" />
                      </div>

                      {/* Chat Input Area */}
                      <div className="shrink-0 px-6 pb-4 md:px-8 md:pb-6 lg:px-10 lg:pb-8 relative z-10 w-full mt-auto">
                        <div className="max-w-4xl mx-auto relative flex items-end gap-2 bg-white/[0.03] border border-white/10 rounded-[1.5rem] transition-all p-2 md:p-2.5 focus-within:border-blue-500/40 focus-within:bg-white/[0.05]">
                          <textarea
                            data-lenis-prevent
                            value={chatInput}
                            onChange={(e) => {
                              setChatInput(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSendChat();
                                (e.target as HTMLTextAreaElement).style.height = 'auto';
                              }
                            }}
                            placeholder="Ask anything..."
                            rows={1}
                            className="flex-1 bg-transparent border-none outline-none py-2 md:py-2.5 text-[14px] leading-relaxed text-white placeholder:text-gray-700 w-full focus:ring-0 resize-none max-h-[120px] custom-scrollbar px-2 overflow-y-auto touch-auto"
                            disabled={isSending}
                          />
                          <button
                            onClick={handleSendChat}
                            disabled={!chatInput.trim() || isSending}
                            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center bg-blue-600/80 text-white rounded-full disabled:opacity-20 hover:bg-blue-600 transition-all shrink-0 shadow-lg mb-0.5"
                          >
                            <Send className="w-3.5 h-3.5 md:w-4 md:h-4 text-white fill-white" />
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
      </div >
    </>
  );
}
