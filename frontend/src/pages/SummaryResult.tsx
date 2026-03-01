import { ArrowLeft, Share2, Play, Sparkles, List, Copy, MessageSquare, Send, Check } from "lucide-react";
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

export function SummaryResult() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as any;

  const [activeTab, setActiveTab] = useState("summary");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleSeek = (seconds: number) => {
    if (playerRef.current && typeof playerRef.current.seekTo === "function") {
      playerRef.current.seekTo(seconds, "seconds");
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  if (!state) {
    return (
      <div className="h-screen bg-[#050505] text-white flex items-center justify-center flex-col gap-4">
        <p className="text-gray-400">No video data. Please summarize a video first.</p>
        <button
          onClick={() => navigate("/summarize")}
          className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
        >
          Go to Summarize
        </button>
      </div>
    );
  }

  const { sessionId, videoUrl, videoId, title, channel, date, summary } = state || {};

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || isSending) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setIsSending(true);

    // Add user message AND placeholder "thinking..." message
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
      setChatMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "ai", content: `**Error:** ${err.message || "Something went wrong."}` };
        return updated;
      });
    } finally {
      setIsSending(false);
    }
  };

  // Safe valid URL for ReactPlayer
  const validUrl = videoUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

  return (
    <div className="h-screen flex flex-col bg-[#050505] text-white overflow-hidden">
      {/* Sticky Header */}
      <div className="shrink-0 z-[100] bg-[#050505]/80 backdrop-blur-xl border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-white/5 rounded-full transition-colors group"
        >
          <ArrowLeft className="w-5 h-5 text-gray-400 group-hover:text-white" />
        </button>
        <h2 className="text-sm font-bold tracking-widest uppercase font-display text-blue-400">Analysis Result</h2>
        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <Share2 className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Main Content Dashboard Layout */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 p-6 overflow-hidden max-w-[1600px] mx-auto w-full">
        
        {/* Left Column: Video & Info */}
        <div className="w-full lg:w-[45%] xl:w-[40%] flex flex-col h-full overflow-y-auto custom-scrollbar pr-2 pb-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl overflow-hidden bg-black aspect-video relative border border-white/10 shadow-lg mb-6 shrink-0"
          >
            {validUrl ? (() => {
              const Player = ReactPlayer as any;
              return (
                <Player
                  ref={playerRef}
                  url={validUrl}
                  width="100%"
                  height="100%"
                  controls={true}
                  playing={isPlaying}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
              );
            })() : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 gap-3">
                <Play className="w-8 h-8 opacity-50" />
                <span className="text-sm font-medium">Video unavailable</span>
              </div>
            )}
          </motion.div>

          <div className="mb-8 shrink-0">
            <h1 className="text-2xl md:text-3xl font-bold font-display tracking-tight mb-3">{title}</h1>
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span className="font-semibold text-gray-300">{channel}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-white/10" />
              <span>{date}</span>
            </div>
          </div>
        </div>

        {/* Right Column: Tabs & Content container */}
        <div className="w-full lg:w-[55%] xl:w-[60%] flex flex-col bg-[#0f1115] border border-white/5 rounded-3xl overflow-hidden shadow-2xl relative h-full">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 blur-[100px] -z-10" />

          {/* Interactive Tabs Header */}
          <div className="shrink-0 flex gap-2 p-3 border-b border-white/5 bg-white/5">
            <button
              onClick={() => setActiveTab("summary")}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                activeTab === "summary" ? "bg-white text-black shadow-lg" : "text-gray-400 hover:text-white"
              )}
            >
              <Sparkles className="w-4 h-4" /> Summary
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                activeTab === "chat" ? "bg-white text-black shadow-lg" : "text-gray-400 hover:text-white"
              )}
            >
              <MessageSquare className="w-4 h-4" /> AI Chat
            </button>
          </div>

          {/* Content Area (Scrollable within container) */}
          <div className="flex-1 overflow-y-auto custom-scrollbar relative">
            <AnimatePresence mode="wait">
              {activeTab === "summary" ? (
                <motion.div
                  key="summary"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="p-8"
                >
                  <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/10 rounded-xl">
                        <Sparkles className="w-5 h-5 text-blue-400" />
                      </div>
                      <h3 className="text-xl font-bold font-serif italic text-blue-400">AI Summary</h3>
                    </div>
                    <button
                      onClick={handleCopy}
                      className="p-2.5 hover:bg-white/5 rounded-xl transition-all border border-white/5 text-gray-400 hover:text-white"
                      title="Copy summary"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="prose prose-invert max-w-none text-gray-300 leading-relaxed font-sans text-base pb-6">
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-6 last:mb-0">{children}</p>,
                        strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
                        a: ({ href, children }) => {
                          const timeMatch = href?.match(/t=(\d+)/);
                          if (timeMatch) {
                            const seconds = parseInt(timeMatch[1], 10);
                            return (
                              <button
                                onClick={() => handleSeek(seconds)}
                                className="text-blue-400 hover:text-blue-300 font-bold inline-flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20 transition-all hover:scale-105 active:scale-95 mx-1"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                {children}
                              </button>
                            );
                          }
                          return <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 underline decoration-blue-500/30 underline-offset-4">{children}</a>;
                        },
                      }}
                    >
                      {summary || "No summary available."}
                    </ReactMarkdown>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="chat"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex flex-col min-h-full"
                >
                  <div className="flex-1 p-6 space-y-6">
                    {chatMessages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-20 mt-10">
                        <MessageSquare className="w-12 h-12 mb-4" />
                        <h4 className="text-lg font-bold mb-2">Ask anything about this video</h4>
                        <p className="text-sm max-w-xs">Our AI has indexed the entire transcript and is ready to answer your questions.</p>
                      </div>
                    ) : (
                      <div className="space-y-6 pb-6 mt-4">
                        {chatMessages.map((msg, i) => (
                           <motion.div 
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              key={i} 
                              className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                           >
                              {msg.role === "ai" && (
                                <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mr-3 mt-1 shrink-0">
                                  <Sparkles className="w-4 h-4 text-blue-400" />
                                </div>
                              )}
                              <div className={cn(
                                "max-w-[85%] p-4 rounded-2xl",
                                msg.role === "user" 
                                  ? "bg-blue-600 text-white rounded-br-sm" 
                                  : "bg-white/5 border border-white/10 text-gray-200 rounded-bl-sm"
                              )}>
                                {msg.content === "thinking..." ? (
                                  <div className="flex items-center gap-1.5 h-6 px-2">
                                    <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 1, repeat: Infinity, delay: 0 }} className="w-2 h-2 rounded-full bg-blue-400" />
                                    <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 1, repeat: Infinity, delay: 0.2 }} className="w-2 h-2 rounded-full bg-blue-400" />
                                    <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 1, repeat: Infinity, delay: 0.4 }} className="w-2 h-2 rounded-full bg-blue-400" />
                                  </div>
                                ) : (
                                  <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 prose-a:text-blue-400 mt-1">
                                    <ReactMarkdown
                                      components={{
                                        a: ({ href, children }) => {
                                          const timeMatch = href?.match(/t=(\d+)/);
                                          if (timeMatch) {
                                            const seconds = parseInt(timeMatch[1], 10);
                                            return (
                                              <button
                                                onClick={() => handleSeek(seconds)}
                                                className="text-blue-400 hover:text-blue-300 font-bold inline-flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20 transition-all hover:scale-105 mx-1"
                                              >
                                                <Play className="w-3 h-3 fill-current" />
                                                {children}
                                              </button>
                                            );
                                          }
                                          return <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 underline underline-offset-2">{children}</a>;
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
                    <div ref={chatEndRef} className="h-8" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Fixed Chat Input Area inside Chat Tab */}
          <AnimatePresence>
            {activeTab === "chat" && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="shrink-0 p-4 bg-black/40 border-t border-white/5"
              >
                <div className="relative flex items-center bg-white/5 border border-white/10 rounded-2xl focus-within:border-blue-500/50 transition-all shadow-lg">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                    placeholder="Ask AI about this video..."
                    className="flex-1 bg-transparent border-none outline-none p-4 text-sm text-white"
                    disabled={isSending}
                  />
                  <button
                    onClick={handleSendChat}
                    disabled={!chatInput.trim() || isSending}
                    className="p-3 mr-1 text-blue-400 hover:text-blue-300 disabled:opacity-30 transition-all"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
