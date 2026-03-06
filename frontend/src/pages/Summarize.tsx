import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLenis } from "lenis/react";
import { cn } from "../lib/utils";
import { useToast } from "../components/GlobalToast";
import { processVideo, summarizeVideo } from "../lib/api";
import { saveHistory } from "../lib/history";

function ProcessingTerminal({ status }: { status: string }) {
  const [step, setStep] = useState(0);
  const steps = [
    { text: "Initializing RAG pipeline...", color: "text-blue-400" },
    { text: "Fetching transcript fragments...", color: "text-gray-300" },
    { text: "Cleaning garbled captions...", color: "text-gray-400" },
    { text: "Generating semantic embeddings...", color: "text-gray-400" },
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
              filter: step > i && step < steps.length ? "grayscale(0.5) opacity(0.5)" : "none"
            }}
            className="flex gap-4 items-start"
          >
            <span className="text-blue-500 shrink-0">❯</span>
            <span className={cn(s.color || "text-gray-300", step > i && "text-green-400", "flex items-center gap-2")}>
              {s.text}
              {step === i && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
              {step > i && <span className="text-[10px] font-bold opacity-60 px-1.5 py-0.5 bg-green-500/10 rounded uppercase">Done</span>}
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
  const navigate = useNavigate();
  const lenis = useLenis();
  const { showToast } = useToast();

  // Summarize content sits near viewport height; keep Lenis bounds fresh on state/layout changes.
  useEffect(() => {
    requestAnimationFrame(() => {
      lenis?.resize();
    });
  }, [lenis, isAnalyzing, status]);

  useEffect(() => {
    if (!("fonts" in document)) return;
    (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => {
      requestAnimationFrame(() => {
        lenis?.resize();
      });
    });
  }, [lenis]);

  const handleSummarize = async (e: FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setIsAnalyzing(true);
    try {
      setStatus("Processing video...");
      const processResult = await processVideo(url);

      if (processResult.status === "no_transcript") {
        showToast(
          processResult.error_message ||
            "Transcript is unavailable right now. Please try again shortly.",
          "error"
        );
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
        starterQuestions: summaryResult.starter_questions || [],
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
      showToast(err.message || "Something went wrong. Please try again.", "error");
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="w-full bg-[#050505] selection:bg-blue-500/30 relative pb-[72px] md:pb-0 overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-600/5 blur-[120px] pointer-events-none" />

      <div className="flex flex-col items-center p-4 md:p-6 lg:p-10 pt-4 md:pt-6 pb-20 md:pb-0">

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-4xl text-center space-y-8 md:space-y-10 relative z-10"
        >
          {!isAnalyzing ? (
            <>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest mx-auto">
                <Sparkles className="w-3.5 h-3.5" />
                ClipIQ Intelligence Engine v2.0
              </div>

              <div className="space-y-4 md:space-y-6">
                <h1 className="text-4xl md:text-8xl font-bold tracking-tight font-serif italic leading-[1.1] md:leading-[0.9] mb-4 text-white">
                  Analyze <br />
                  <span className="text-blue-500">any video.</span>
                </h1>
                <p className="text-gray-500 text-sm md:text-xl max-w-xl mx-auto font-sans leading-relaxed px-6 md:px-0">
                  Unlock the knowledge hidden in hours of video content. Get instant summaries, citations, and interactive answers.
                </p>
              </div>

              <form onSubmit={handleSummarize} className="relative max-w-2xl mx-auto mt-8 md:mt-12 group px-4 md:px-0">
                <div className="relative flex flex-col sm:flex-row items-center bg-white/[0.03] border border-white/10 rounded-full p-2 backdrop-blur-xl transition-all focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:border-blue-500/30 gap-2">
                  <div className="flex items-center flex-1 px-2">
                    <div className="pl-4 pr-2 text-white/40 group-focus-within:text-blue-500 transition-colors shrink-0 relative z-10">
                      <Link2 className="w-4 h-4" />
                    </div>
                    <input
                      type="url"
                      placeholder="Paste YouTube URL..."
                      className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-800 h-10 md:h-12 text-base md:text-lg font-medium w-full"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      disabled={isAnalyzing}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!url || isAnalyzing}
                    className={cn(
                      "relative group h-10 md:h-12 pl-2 pr-8 rounded-full transition-all duration-500 active:scale-[0.97] overflow-hidden shrink-0",
                      url && !isAnalyzing
                        ? "bg-white text-black shadow-[0_10px_20px_-10px_rgba(0,0,0,0.5)]"
                        : "bg-white/5 text-gray-700 cursor-not-allowed border border-white/5"
                    )}
                  >
                    <div className="relative z-10 flex items-center justify-center gap-2 transition-colors duration-500">
                      <div className={cn(
                        "w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-all duration-500 bg-black/[0.03] group-hover:bg-blue-600",
                        !url || isAnalyzing ? "bg-white/5" : ""
                      )}>
                        {isAnalyzing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-black/50" />
                        ) : (
                          <Sparkles className={cn("w-3.5 h-3.5 transition-colors", url && !isAnalyzing ? "text-blue-600 group-hover:text-white" : "text-gray-800")} />
                        )}
                      </div>
                      <span className="text-[11px] font-bold tracking-[0.05em] uppercase font-display">
                        {isAnalyzing ? "PROCESSING..." : "GENERATE ANALYSIS"}
                      </span>
                    </div>

                    {/* Fluid Gradient Flow on Hover */}
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-400/0 via-blue-400/10 to-purple-400/0 opacity-0 group-hover:opacity-100 translate-x-[-100%] group-hover:translate-x-[100%] transition-all duration-[1s] ease-in-out pointer-events-none" />
                  </button>
                </div>
              </form>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 max-w-3xl mx-auto">
                {[
                  { label: "Podcasts", desc: "Long-form insights" },
                  { label: "Lectures", desc: "Key academic points" },
                  { label: "Tech Tutorials", desc: "Step-by-step logic" },
                  { label: "Documentaries", desc: "Narrative summaries" }
                ].map(t => (
                  <div
                    key={t.label}
                    className="p-4 bg-[#0a0a0a] border border-white/5 rounded-2xl text-left hover:border-blue-500/30 transition-all cursor-default group"
                  >
                    <div className="text-[11px] font-bold text-white uppercase tracking-wider mb-1 group-hover:text-blue-400 transition-colors">{t.label}</div>
                    <div className="text-[10px] text-gray-600 font-medium">{t.desc}</div>
                  </div>
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
                <h2 className="text-3xl md:text-5xl font-bold font-serif italic tracking-tight">Hang tight, analyzing...</h2>
                <p className="text-gray-500 text-xs md:text-sm max-w-sm mx-auto px-4">Our temporal engine is scanning fragments to build a semantic map of the video.</p>
              </motion.div>
              <ProcessingTerminal status={status} />
            </div>
          )}

          <p className="text-[10px] text-gray-700 mt-20 md:mt-8 font-bold uppercase tracking-widest opacity-30">
            ClipIQ Intelligence System • Verified Reasoning
          </p>
        </motion.div>
      </div>
    </div>
  );
}
