import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, ArrowRight, Sparkles, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { processVideo, summarizeVideo } from "../lib/api";
import { saveHistory } from "../lib/history";

const SUGGESTIONS = [
  { label: "Summarize a TED Talk", url: "https://www.youtube.com/watch?v=UF8uR6Z6KLc" },
  { label: "Analyze a podcast", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  { label: "Get key points", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
  { label: "Study a lecture", url: "https://www.youtube.com/watch?v=aircAruvnKk" },
];

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
      // Step 1: Process the video
      setStatus("Processing video transcript...");
      const processResult = await processVideo(url);

      if (processResult.status === "no_transcript") {
        setError("No transcript available for this video. Please try a video with captions enabled.");
        setIsAnalyzing(false);
        return;
      }

      // Step 2: Generate summary
      setStatus("Generating AI summary...");
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

      // Navigate to result page with data
      navigate("/summary-result", {
        state: resultData,
      });
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6 bg-[#050505] selection:bg-blue-500/30">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-3xl text-center space-y-8"
      >

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mx-auto">
          <Sparkles className="w-3.5 h-3.5" />
          AI-Powered Summarization
        </div>

        <div className="space-y-6">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight font-display leading-[1.1]">
            What would you like <br />
            to <span className="font-serif italic text-blue-500">summarize?</span>
          </h1>
          <p className="text-gray-500 text-lg md:text-xl max-w-xl mx-auto font-sans">
            Paste a YouTube URL and get instant AI-powered insights, key takeaways, and interactive transcripts.
          </p>
        </div>

        <form onSubmit={handleSummarize} className="relative max-w-3xl mx-auto mt-16 group">
          <div className="relative flex items-center bg-[#0f1115] border border-white/5 rounded-3xl p-3 focus-within:border-blue-500/30 transition-all shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] group-hover:shadow-[0_48px_80px_-20px_rgba(0,0,0,0.6)]">
            <div className="pl-5 pr-4 text-gray-600">
              <Link2 className="w-6 h-6" />
            </div>
            <input
              type="url"
              placeholder="Paste YouTube URL here..."
              className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-700 h-14 text-xl font-medium"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isAnalyzing}
              required
            />
            <button
              type="submit"
              disabled={!url || isAnalyzing}
              className={cn(
                "ml-3 px-8 py-4 rounded-2xl font-bold text-sm tracking-widest uppercase transition-all",
                url && !isAnalyzing
                  ? "bg-white text-black hover:bg-gray-100 shadow-[0_0_40px_rgba(255,255,255,0.1)] active:scale-[0.98]"
                  : "bg-white/5 text-gray-600 cursor-not-allowed"
              )}
            >
              {isAnalyzing ? (
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                  Processing
                </div>
              ) : (
                "Summarize"
              )}
            </button>
          </div>
        </form>

        {/* Status message */}
        {isAnalyzing && status && (
          <div className="flex items-center justify-center gap-2 text-sm text-blue-400 animate-pulse">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
            {status}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-center justify-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 max-w-2xl mx-auto">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 mt-10">
          {SUGGESTIONS.map((suggestion, i) => (
            <button
              key={i}
              className="px-4 py-2 rounded-full bg-white/5 border border-white/5 text-sm text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
              onClick={() => setUrl(suggestion.url)}
              disabled={isAnalyzing}
            >
              {suggestion.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-600 mt-16">
          ClipIQ may produce inaccurate information. Verify important details.
        </p>
      </motion.div>
    </div>
  );
}
