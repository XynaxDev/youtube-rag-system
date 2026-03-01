import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, ArrowRight, Sparkles, AlertCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import { processVideo, summarizeVideo } from "../lib/api";
import { saveHistory } from "../lib/history";

function ProcessingTerminal({ status }: { status: string }) {
  const [step, setStep] = useState(0);
  const steps = [
    { text: "Initializing RAG pipeline...", color: "text-blue-400" },
    { text: "Fetching transcript fragments...", color: "text-gray-300" },
    { text: "Cleaning garbled captions...", done: true },
    { text: "Generating semantic embeddings...", done: true },
    { text: "Extracting key insights...", color: "text-blue-400" },
    { text: "Finalizing analysis...", color: "text-green-400" },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-2xl mx-auto bg-[#0a0a0a] border border-white/10 rounded-3xl p-8 relative shadow-2xl mt-12 overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[60px] pointer-events-none"></div>
      <div className="flex items-center gap-3 mb-8 border-b border-white/5 pb-4">
        <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
        <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
        <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
        <span className="text-[10px] text-gray-600 font-mono ml-2 uppercase tracking-widest flex items-center gap-2">
          ClipIQ_Engine_v2.1 <span className="w-1 h-1 rounded-full bg-gray-800" /> {status}
        </span>
      </div>
      <div className="space-y-4 font-mono text-sm leading-relaxed text-left">
        {steps.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{
              opacity: step >= i ? 1 : 0.2,
              x: step >= i ? 0 : -10,
              filter: step > i ? "grayscale(0.5) opacity(0.5)" : "none"
            }}
            className="flex gap-4 items-start"
          >
            <span className="text-blue-500 shrink-0">❯</span>
            <span className={cn(s.color || "text-gray-300", s.done && step > i && "text-green-400", "flex items-center gap-2")}>
              {s.text}
              {step === i && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
              {s.done && step > i && <span className="text-[10px] font-bold opacity-60 px-1.5 py-0.5 bg-green-500/10 rounded uppercase">Done</span>}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

export function Summarize() {
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSummarize = async (e: FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setIsAnalyzing(true);
    setError("");

    try {
      setStatus("Processing video...");
      const processResult = await processVideo(url);

      if (processResult.status === "no_transcript") {
        setError("No transcript available for this video. Please try a video with captions enabled.");
        setIsAnalyzing(false);
        return;
      }

      setStatus("Summarizing content...");
      const summaryResult = await summarizeVideo(processResult.session_id, url);

      const resultData = {
        sessionId: processResult.session_id,
        videoUrl: url,
        videoId: processResult.video_id,
        title: processResult.title,
        channel: processResult.channel,
        date: processResult.date,
        description: processResult.description,
        summary: summaryResult.summary,
        chunkCount: processResult.chunk_count,
      };

      saveHistory({
        type: "Summary",
        title: processResult.title,
        channel: processResult.channel,
        date: processResult.date || new Date().toLocaleDateString(),
        result: resultData,
      });

      navigate("/summary-result", {
        state: resultData,
      });
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#050505] selection:bg-blue-500/30 overflow-hidden relative">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-600/5 blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-4xl text-center space-y-10 relative z-10"
      >
        {!isAnalyzing ? (
          <>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest mx-auto">
              <Sparkles className="w-3.5 h-3.5" />
              ClipIQ Neural Engine v2.0
            </div>

            <div className="space-y-6">
              <h1 className="text-6xl md:text-8xl font-bold tracking-tight font-display leading-[0.9] mb-4">
                Analyze <br />
                <span className="font-serif italic text-blue-500">any video.</span>
              </h1>
              <p className="text-gray-500 text-lg md:text-xl max-w-xl mx-auto font-sans leading-relaxed">
                Unlock the knowledge hidden in hours of video content. Get instant summaries, citations, and interactive answers.
              </p>
            </div>

            <form onSubmit={handleSummarize} className="relative max-w-3xl mx-auto mt-16 group">
              <div className="relative flex items-center bg-[#0a0a0a] border border-white/10 rounded-[2rem] p-3 focus-within:border-blue-500/40 transition-all shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)]">
                <div className="pl-6 pr-4 text-gray-600 group-focus-within:text-blue-500 transition-colors">
                  <Link2 className="w-6 h-6" />
                </div>
                <input
                  type="url"
                  placeholder="Paste any YouTube URL..."
                  className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-800 h-16 text-xl font-medium"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={isAnalyzing}
                  required
                />
                <button
                  type="submit"
                  disabled={!url || isAnalyzing}
                  className={cn(
                    "ml-3 px-10 py-5 rounded-[1.25rem] font-bold text-sm tracking-widest uppercase transition-all",
                    url && !isAnalyzing
                      ? "bg-white text-black hover:bg-gray-100 shadow-xl active:scale-[0.98]"
                      : "bg-white/5 text-gray-700 cursor-not-allowed"
                  )}
                >
                  Generate
                </button>
              </div>
            </form>

            <div className="flex flex-wrap items-center justify-center gap-4 mt-12 opacity-40 hover:opacity-100 transition-opacity">
              <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Supported:</span>
              {["Podcasts", "Lectures", "Tech Tutorials", "Documentaries"].map(t => (
                <span key={t} className="px-3 py-1 bg-white/5 border border-white/5 rounded-full text-[10px] text-gray-500 capitalize">{t}</span>
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-12 py-10">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="space-y-4"
            >
              <h2 className="text-4xl font-bold font-display tracking-tight">Hang tight, analyzing...</h2>
              <p className="text-gray-500 max-w-sm mx-auto">Our temporal engine is scanning fragments to build a semantic map of the video.</p>
            </motion.div>
            <ProcessingTerminal status={status} />
          </div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-3 text-sm text-red-400 bg-red-500/5 border border-red-500/10 rounded-2xl px-6 py-4 max-w-2xl mx-auto shadow-2xl"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </motion.div>
        )}

        <p className="text-[10px] text-gray-700 mt-20 font-bold uppercase tracking-widest opacity-30">
          ClipIQ Neural Engine • Verified Reasoning
        </p>
      </motion.div>
    </div>
  );
}
