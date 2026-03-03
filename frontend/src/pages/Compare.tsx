import { useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Link2,
  Scale,
  Check,
  Loader2,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useLenis } from "lenis/react";
import { compareVideos, processVideo } from "../lib/api";
import { cn } from "../lib/utils";
import { saveHistory } from "../lib/history";
import { useToast } from "../components/GlobalToast";

const DEFAULT_COMPARE_QUESTION =
  "Give a complete dual-video intelligence summary with key differences, strongest takeaways, and a clear recommendation only when learning context is valid.";
const FALLBACK_ERROR = "We have some server issue. We will get back soon.";

function ProcessingTerminal({ status }: { status: string }) {
  const [step, setStep] = useState(0);
  const steps = [
    { text: "Initializing dual-pipeline...", color: "text-blue-400" },
    { text: "Syncing temporal maps...", color: "text-gray-300" },
    { text: "Cross-referencing logic fragments...", color: "text-gray-400" },
    { text: "Generating comparative embeddings...", color: "text-gray-400" },
    { text: "Extracting divergent insights...", color: "text-blue-400" },
    { text: "Finalizing intelligence map...", color: "text-green-400" },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 1800);
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
          ClipIQ_Sync_v2.5 <span className="w-1 h-1 rounded-full bg-gray-800" /> {status}
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
              filter: step > i && step < steps.length ? "grayscale(0.5) opacity(0.5)" : "none",
            }}
            className="flex gap-4 items-start"
          >
            <span className="text-blue-500 shrink-0">❯</span>
            <span className={cn(s.color, step > i && "text-green-400", "flex items-center gap-2")}>
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

export function Compare() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [url1, setUrl1] = useState("");
  const [url2, setUrl2] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isComparing, setIsComparing] = useState(false);
  const lenis = useLenis();

  useEffect(() => {
    requestAnimationFrame(() => {
      lenis?.resize();
    });
  }, [lenis, isComparing, error, status]);

  useEffect(() => {
    if (!("fonts" in document)) return;
    (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => {
      requestAnimationFrame(() => {
        lenis?.resize();
      });
    });
  }, [lenis]);

  const handleCompare = async (e: FormEvent) => {
    e.preventDefault();
    if (!url1.trim() || !url2.trim() || isComparing) return;
    setIsComparing(true);
    setError("");
    setStatus("Booting pipeline");

    try {
      setStatus("Processing stream A");
      const procA = await processVideo(url1.trim());
      setStatus("Processing stream B");
      const procB = await processVideo(url2.trim());
      setStatus("Generating contrast map");

      const result = await compareVideos(procA.session_id, url1.trim(), url2.trim(), DEFAULT_COMPARE_QUESTION);

      const metaA = result.video_a || { title: procA.title, channel: procA.channel, date: procA.date };
      const metaB = result.video_b || { title: procB.title, channel: procB.channel, date: procB.date };

      saveHistory({
        type: "Comparison",
        title: `Compare: ${procA.title.slice(0, 20)} vs ${procB.title.slice(0, 20)}`,
        channel: `${procA.channel} & ${procB.channel}`,
        date: new Date().toLocaleDateString(),
        result: {
          response: result.response,
          video_a: metaA,
          video_b: metaB,
          session_id: procA.session_id,
          url1: url1.trim(),
          url2: url2.trim(),
          restored: true,
        },
      });

      showToast("Intelligence map ready", "success");

      navigate("/compare-result", {
        state: {
          response: result.response,
          video_a: metaA,
          video_b: metaB,
          session_id: procA.session_id,
          url1: url1.trim(),
          url2: url2.trim(),
        },
      });
    } catch (err: any) {
      const msg = err?.message || FALLBACK_ERROR;
      setError(msg);
      showToast(msg, "error");
    } finally {
      setStatus("");
      setIsComparing(false);
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
          {!isComparing ? (
            <>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest mx-auto">
                <Scale className="w-3.5 h-3.5" />
                Contrast & Synthesis
              </div>

              <div className="space-y-4 md:space-y-6">
                <h1 className="text-4xl md:text-8xl font-bold tracking-tight font-serif italic leading-[1.1] md:leading-[0.9] mb-4 text-white">
                  Compare <br />
                  <span className="text-blue-500">Intelligence.</span>
                </h1>
                <p className="text-gray-500 text-sm md:text-xl max-w-xl mx-auto font-sans leading-relaxed px-6 md:px-0">
                  Cross-reference two videos to find key differences, missing context, and the ultimate technical verdict.
                </p>
              </div>

              <form onSubmit={handleCompare} className="relative max-w-2xl mx-auto mt-8 md:mt-12 group px-4 md:px-0">
                <div className="bg-[#0a0a0a] border border-white/10 rounded-[2rem] p-4 md:p-8 shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] relative space-y-4 md:space-y-6">
                  <div className="absolute inset-0 bg-blue-500/[0.02] rounded-[2rem] pointer-events-none" />
                  <div className="relative group/input">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-700 group-focus-within/input:text-blue-500 transition-colors"><Link2 className="w-5 h-5" /></div>
                    <input type="url" value={url1} onChange={(e) => setUrl1(e.target.value)} placeholder="Video A URL..." className="w-full bg-black/50 border border-white/10 rounded-2xl h-14 pl-12 pr-4 text-[15px] outline-none focus:border-blue-500/40 transition-all font-medium placeholder:text-gray-800" />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-700 pointer-events-none uppercase tracking-widest">Base Stream</div>
                  </div>
                  <div className="relative group/input">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-700 group-focus-within/input:text-purple-500 transition-colors"><Link2 className="w-5 h-5" /></div>
                    <input type="url" value={url2} onChange={(e) => setUrl2(e.target.value)} placeholder="Video B URL..." className="w-full bg-black/50 border border-white/10 rounded-2xl h-14 pl-12 pr-4 text-[15px] outline-none focus:border-purple-500/40 transition-all font-medium placeholder:text-gray-800" />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-700 pointer-events-none uppercase tracking-widest">Target Stream</div>
                  </div>
                  <div className="flex flex-col md:flex-row items-center justify-between gap-6 md:gap-0 pt-2">
                    <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-blue-500/40" />
                      Temporal Syncing Enabled
                    </div>
                    <button
                      type="submit"
                      disabled={!url1.trim() || !url2.trim() || isComparing}
                      className={cn(
                        "w-full md:w-auto px-6 h-10 md:h-12 md:px-8 rounded-xl md:rounded-[1rem] font-bold text-[10px] md:text-[11px] tracking-widest uppercase transition-all whitespace-nowrap inline-flex items-center justify-center gap-3",
                        url1.trim() && url2.trim()
                          ? "bg-white text-black hover:bg-gray-100 shadow-xl active:scale-[0.98]"
                          : "bg-white/5 text-gray-700 cursor-not-allowed"
                      )}
                    >
                      <Scale className="w-4 h-4" />
                      Contrast Hub
                    </button>
                  </div>
                </div>
              </form>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12 max-w-3xl mx-auto">
                {[
                  { label: "Podcasts", desc: "Cross-reference takes" },
                  { label: "Lectures", desc: "Compare key concepts" },
                  { label: "Reviews", desc: "Find consensus" },
                  { label: "Tutorials", desc: "Compare approaches" },
                ].map((t) => (
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
                <h2 className="text-3xl md:text-5xl font-bold font-serif italic tracking-tight">Syncing Streams...</h2>
                <p className="text-gray-500 text-xs md:text-sm max-w-sm mx-auto px-4">Cross-referencing temporal data to find divergent context points.</p>
              </motion.div>
              <ProcessingTerminal status={status || "Initializing"} />
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

          <p className="text-[10px] text-gray-700 mt-20 md:mt-8 font-bold uppercase tracking-widest opacity-30">
            ClipIQ Intelligence System • Verified Reasoning
          </p>
        </motion.div>
      </div>
    </div>
  );
}
