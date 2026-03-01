import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Link2, Sparkles, Clock, Layers, Star, ArrowRight, AlertCircle, Send, MessageSquare, Loader2, CheckCircle2, Scale } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { processVideo, compareVideos } from "../lib/api";
import { saveHistory } from "../lib/history";

export function Compare() {
  const [url1, setUrl1] = useState("");
  const [url2, setUrl2] = useState("");
  const [isComparing, setIsComparing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [comparisonResult, setComparisonResult] = useState("");
  const [videoA, setVideoA] = useState<Record<string, string> | null>(null);
  const [videoB, setVideoB] = useState<Record<string, string> | null>(null);
  const [sessionId, setSessionId] = useState("");

  // Follow-up chat
  const [followUp, setFollowUp] = useState("");
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [followUpMessages, setFollowUpMessages] = useState<Array<{ role: string; content: string }>>([]);

  const location = useLocation();
  const state = location.state as any;

  useEffect(() => {
    if (state?.restored) {
      setUrl1(state.url1 || "");
      setUrl2(state.url2 || "");
      setComparisonResult(state.response || "");
      setVideoA(state.video_a || null);
      setVideoB(state.video_b || null);
      setSessionId(state.session_id || "");
      setShowResult(true);
    }
  }, [state]);

  const handleCompare = async () => {
    if (!url1 || !url2) return;
    setIsComparing(true);
    setError("");
    setShowResult(false);

    try {
      // Process both videos
      setStatus("Processing first video...");
      const proc1 = await processVideo(url1);

      setStatus("Processing second video...");
      const proc2 = await processVideo(url2);

      const sid = proc1.session_id;
      setSessionId(sid);

      // Run comparison
      setStatus("Comparing videos with AI...");
      const result = await compareVideos(
        sid, url1, url2,
        "Compare both videos and tell me which one is better for learning. Provide a detailed analysis."
      );

      setComparisonResult(result.response);
      setVideoA(result.video_a || { title: proc1.title, channel: proc1.channel });
      setVideoB(result.video_b || { title: proc2.title, channel: proc2.channel });
      setShowResult(true);

      const resultData = {
        response: result.response,
        video_a: result.video_a || { title: proc1.title, channel: proc1.channel },
        video_b: result.video_b || { title: proc2.title, channel: proc2.channel },
        session_id: sid,
        url1,
        url2
      };

      saveHistory({
        type: "Comparison",
        title: `Compare: ${proc1.title.substring(0, 20)}... vs ${proc2.title.substring(0, 20)}...`,
        channel: `${proc1.channel} & ${proc2.channel}`,
        date: "Today",
        result: resultData,
      });
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setIsComparing(false);
    }
  };

  const handleFollowUp = async () => {
    if (!followUp.trim() || isSendingFollowUp || !sessionId) return;
    const question = followUp.trim();
    setFollowUp("");
    setFollowUpMessages((prev) => [...prev, { role: "user", content: question }]);
    setIsSendingFollowUp(true);

    try {
      const result = await compareVideos(sessionId, url1, url2, question);
      setFollowUpMessages((prev) => [...prev, { role: "ai", content: result.response }]);
    } catch (err: any) {
      setFollowUpMessages((prev) => [...prev, { role: "ai", content: `Error: ${err.message}` }]);
    } finally {
      setIsSendingFollowUp(false);
    }
  };

  return (
    <div className="min-h-full p-6 lg:p-10 bg-[#050505] selection:bg-blue-500/30">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-6xl mx-auto"
      >
        <div className="flex flex-col items-center justify-center text-center mb-16 gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest">
            Video showdown
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight font-serif italic">Face-off analysis</h1>
          <p className="text-gray-400 max-w-lg text-sm leading-relaxed">
            Paste two links to analyze information depth, time efficiency, and find the absolute best resource for your learning journey.
          </p>
        </div>

        <div className="max-w-4xl mx-auto space-y-12">
          <div className="lg:col-span-12 space-y-8">
            <div className="flex flex-col md:flex-row gap-8 items-center justify-center max-w-4xl mx-auto">
              {/* Video 1 */}
              <div className="flex-1 w-full bg-[#0f1115] border border-white/5 rounded-[2rem] p-8 relative hover:border-blue-500/30 transition-colors shadow-xl">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-600/10 text-blue-400 flex items-center justify-center text-xs font-bold border border-blue-500/20">1</div>
                    <h3 className="font-semibold text-gray-300">Target video A</h3>
                  </div>
                </div>
                <div className="relative flex items-center bg-black/60 border border-white/5 rounded-2xl p-2 focus-within:border-blue-500/50 transition-all">
                  <div className="pl-4 pr-3 text-gray-600">
                    <Link2 className="w-5 h-5" />
                  </div>
                  <input
                    type="url"
                    placeholder="Paste URL..."
                    className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-700 h-12 text-sm"
                    value={url1}
                    onChange={(e) => setUrl1(e.target.value)}
                    disabled={isComparing}
                  />
                </div>
              </div>

              <div className="flex items-center justify-center z-10">
                <div className="w-14 h-14 rounded-full bg-[#0a0a0a] border border-white/10 flex items-center justify-center text-xs font-bold text-gray-500 shadow-2xl relative">
                  <div className="absolute inset-0 rounded-full border border-blue-500/20 animate-[spin_10s_linear_infinite]" />
                  VS
                </div>
              </div>

              {/* Video 2 */}
              <div className="flex-1 w-full bg-[#0f1115] border border-white/5 rounded-[2rem] p-8 relative hover:border-purple-500/30 transition-colors shadow-xl">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-purple-600/10 text-purple-400 flex items-center justify-center text-xs font-bold border border-purple-500/20">2</div>
                    <h3 className="font-semibold text-gray-300">Target video B</h3>
                  </div>
                </div>
                <div className="relative flex items-center bg-black/60 border border-white/5 rounded-2xl p-2 focus-within:border-purple-500/50 transition-all">
                  <div className="pl-4 pr-3 text-gray-600">
                    <Link2 className="w-5 h-5" />
                  </div>
                  <input
                    type="url"
                    placeholder="Paste URL..."
                    className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-700 h-12 text-sm"
                    value={url2}
                    onChange={(e) => setUrl2(e.target.value)}
                    disabled={isComparing}
                  />
                </div>
              </div>
            </div>

            {/* Analysis Criteria */}
            <div className="bg-[#0f1115] border border-white/5 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Analysis Criteria</h3>
                <span className="text-xs text-gray-500">AI-powered analysis</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-600/10 border border-blue-500/20 rounded-xl p-4 flex flex-col items-center justify-center text-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-400" />
                  <span className="text-xs font-medium text-blue-100">Information depth</span>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col items-center justify-center text-center gap-2">
                  <Clock className="w-5 h-5 text-gray-400" />
                  <span className="text-xs font-medium text-gray-300">Time efficiency</span>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col items-center justify-center text-center gap-2">
                  <Layers className="w-5 h-5 text-gray-400" />
                  <span className="text-xs font-medium text-gray-300">Content quality</span>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Status */}
            {isComparing && status && (
              <div className="flex items-center gap-2 text-sm text-blue-400 animate-pulse px-2">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                {status}
              </div>
            )}

            <button
              onClick={handleCompare}
              disabled={!url1 || !url2 || isComparing}
              className={cn(
                "w-full py-5 rounded-2xl font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all",
                url1 && url2 && !isComparing
                  ? "bg-white text-black hover:bg-gray-100 shadow-[0_0_30px_rgba(255,255,255,0.1)] active:scale-[0.98]"
                  : "bg-white/5 text-gray-600 cursor-not-allowed"
              )}
            >
              {isComparing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing videos...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Launch Duel Analysis
                </>
              )}
            </button>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-12 mt-12">
            <div className="max-w-4xl mx-auto">
              {showResult ? (
                <div className="space-y-8">
                  <div className="bg-[#0f1115] border border-white/5 rounded-[2rem] p-8 md:p-12 shadow-2xl">
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-2xl font-serif italic text-white/90">The Verdict</h3>
                      <div className="px-4 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3" />
                        Knowledge Map Finalized
                      </div>
                    </div>

                    <div className="prose prose-invert max-w-none text-gray-300 leading-relaxed font-sans text-base">
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-6 last:mb-0">{children}</p>,
                          strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
                          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline decoration-blue-500/30 underline-offset-4">{children}</a>,
                        }}
                      >
                        {comparisonResult}
                      </ReactMarkdown>
                    </div>
                  </div>

                  {/* Recommendation Card */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-gradient-to-br from-blue-600/20 via-purple-600/10 to-transparent border border-blue-500/20 rounded-[2rem] p-8 flex flex-col items-center text-center gap-6"
                  >
                    <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                      <Star className="w-8 h-8 fill-current" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold mb-2 font-display">Best video to watch</h3>
                      <p className="text-gray-400 max-w-md mx-auto">Based on information density, pedagogical clarity, and time efficiency, our AI recommends starting with video A.</p>
                    </div>
                    <Link to="/dashboard" className="px-8 py-3 bg-white text-black rounded-full font-bold text-sm tracking-wider hover:bg-gray-100 transition-all">
                      VIEW TIMESTAMPS
                    </Link>
                  </motion.div>
                </div>
              ) : (
                <div className="bg-[#0f1115] border border-white/5 rounded-[2rem] p-12 text-center flex flex-col items-center gap-6 opacity-40 grayscale group hover:grayscale-0 hover:opacity-100 transition-all duration-700">
                  <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-4 group-hover:bg-blue-500/10 transition-colors">
                    <Scale className="w-10 h-10 text-gray-600 group-hover:text-blue-400" />
                  </div>
                  <h3 className="text-2xl font-serif italic">Your winner will appear here</h3>
                  <p className="text-gray-500 max-w-sm font-sans leading-relaxed">
                    Once the dual processing is complete, we'll weigh both resources and present the definitive winner based on your goals.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
