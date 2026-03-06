import { useEffect, useState, type FormEvent } from "react";
import {
  Link2,
  Scale,
  Check,
  Loader2,
  FlaskConical,
  Info,
} from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useLenis } from "lenis/react";
import { checkTechnicalVideos, compareVideos, processVideo } from "../lib/api";
import { cn } from "../lib/utils";
import { saveHistory } from "../lib/history";
import { useToast } from "../components/GlobalToast";

const DEFAULT_COMPARE_QUESTION =
  "Give a complete dual-video intelligence summary with key differences, strongest takeaways, and a clear recommendation only when learning context is valid.";
const FALLBACK_ERROR = "We have some server issue. We will get back soon.";

const extractVideoId = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "");
    if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v") || "";
  } catch {
    return "";
  }
  return "";
};

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
  const [isComparing, setIsComparing] = useState(false);
  const [studyModeEnabled, setStudyModeEnabled] = useState(false);
  const [isStudyHintOpen, setIsStudyHintOpen] = useState(false);
  const lenis = useLenis();

  const handleToggleStudyMode = () => {
    const next = !studyModeEnabled;
    setStudyModeEnabled(next);
    showToast(next ? "Study Mode enabled" : "Study Mode disabled", "success");
  };

  useEffect(() => {
    requestAnimationFrame(() => {
      lenis?.resize();
    });
  }, [lenis, isComparing, status]);

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
    const cleanUrl1 = url1.trim();
    const cleanUrl2 = url2.trim();
    if (!cleanUrl1 || !cleanUrl2 || isComparing) return;

    const id1 = extractVideoId(cleanUrl1);
    const id2 = extractVideoId(cleanUrl2);
    const sameInput =
      cleanUrl1.toLowerCase() === cleanUrl2.toLowerCase() ||
      (id1 && id2 && id1 === id2);
    if (sameInput) {
      const msg = "Use different video URLs for comparison.";
      showToast(msg, "error");
      return;
    }

    setIsComparing(true);
    setStatus("Booting pipeline");

    try {
      setStatus("Processing stream A");
      const procA = await processVideo(cleanUrl1);
      setStatus("Processing stream B");
      const procB = await processVideo(cleanUrl2, procA.session_id);
      let effectiveStudyMode = studyModeEnabled;
      // Do not block or auto-disable when study mode is explicitly enabled by the user.
      // When study mode is OFF, run a lightweight background check and suggest enabling it.
      if (!studyModeEnabled) {
        checkTechnicalVideos(procA.session_id, cleanUrl1, cleanUrl2)
          .then((technicalCheck) => {
            if (technicalCheck.is_technical) {
              showToast(
                "Technical content detected. You can enable Study Mode for deeper analysis.",
                "info"
              );
            }
          })
          .catch(() => {
            // Non-blocking hint only; ignore check failures.
          });
      }
      setStatus("Generating contrast map");

      const result = await compareVideos(
        procA.session_id,
        cleanUrl1,
        cleanUrl2,
        DEFAULT_COMPARE_QUESTION,
        effectiveStudyMode,
        false
      );

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
          url1: cleanUrl1,
          url2: cleanUrl2,
          study_mode: effectiveStudyMode,
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
          url1: cleanUrl1,
          url2: cleanUrl2,
          study_mode: effectiveStudyMode,
        },
      });
    } catch (err: any) {
      const msg = err?.message || FALLBACK_ERROR;
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
                <div className="bg-[#0a0a0a] border border-white/5 rounded-[3rem] p-6 md:p-10 shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] relative space-y-5 md:space-y-6">
                  <div className="absolute inset-0 bg-blue-500/[0.01] rounded-[3rem] pointer-events-none" />
                  <div className="relative group/input">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within/input:text-blue-400 transition-colors z-10"><Link2 className="w-4 h-4" /></div>
                    <input type="url" value={url1} onChange={(e) => setUrl1(e.target.value)} placeholder="Video A URL..." className="w-full bg-black/40 border border-white/5 rounded-full h-14 pl-14 pr-6 text-[14px] outline-none focus:border-blue-500/30 transition-all font-medium placeholder:text-gray-800 backdrop-blur-sm" />
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 text-[8px] font-bold text-gray-700 pointer-events-none uppercase tracking-widest bg-white/5 px-3 py-1.5 rounded-full ring-1 ring-white/10">Base Stream</div>
                  </div>
                  <div className="relative group/input">
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within/input:text-purple-400 transition-colors z-10"><Link2 className="w-4 h-4" /></div>
                    <input type="url" value={url2} onChange={(e) => setUrl2(e.target.value)} placeholder="Video B URL..." className="w-full bg-black/40 border border-white/5 rounded-full h-14 pl-14 pr-6 text-[14px] outline-none focus:border-purple-500/30 transition-all font-medium placeholder:text-gray-800 backdrop-blur-sm" />
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 text-[8px] font-bold text-gray-700 pointer-events-none uppercase tracking-widest bg-white/5 px-3 py-1.5 rounded-full ring-1 ring-white/10">Target Stream</div>
                  </div>
                  <div className="pt-2 space-y-2">
                    <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 md:gap-3 w-full">
                      <div className="w-full md:w-fit h-10 md:h-12 px-5 rounded-full border border-white/5 bg-white/[0.03] flex items-center justify-between gap-6 backdrop-blur-md shadow-inner">
                        <div className="flex items-center gap-3">
                          <FlaskConical className={cn("w-3.5 h-3.5", studyModeEnabled ? "text-green-400" : "text-blue-400")} />
                          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
                            Deep Study Mode
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div
                            className="relative flex items-center"
                            onMouseEnter={() => setIsStudyHintOpen(true)}
                            onMouseLeave={() => setIsStudyHintOpen(false)}
                          >
                            <button
                              type="button"
                              aria-label="Study mode info"
                              className="w-7 h-7 rounded-full border border-white/10 bg-white/5 text-gray-400 hover:text-white hover:border-white/20 transition-all flex items-center justify-center group/info"
                            >
                              <Info className="w-3.5 h-3.5 transition-transform group-hover/info:scale-110" />
                            </button>
                            <div className={cn(
                              "absolute top-full mt-2 right-0 w-[240px] sm:w-[300px] md:w-[380px] max-w-[calc(100vw-1rem)] rounded-2xl border border-white/15 bg-[#101219]/95 backdrop-blur-xl p-4 text-left shadow-2xl z-30 transition-all duration-200",
                              isStudyHintOpen ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-1 pointer-events-none"
                            )}>
                              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-300 mb-2">When To Use Study Mode</p>
                              <p className="text-[11px] text-gray-300 leading-relaxed mb-2">
                                Use it for technical talks, lectures, tutorials, coding/system design, research breakdowns, or deep analytical discussions.
                              </p>
                              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-1">Why Use It</p>
                              <ul className="space-y-1.5 text-[11px] text-gray-400 leading-relaxed">
                                <li>Deeper concept-level comparison across both videos.</li>
                                <li>Structured technical verdict with stronger reasoning depth.</li>
                                <li>Actionable study guidance when content supports it.</li>
                              </ul>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleToggleStudyMode}
                            aria-label="Toggle study mode"
                            className={cn(
                              "relative w-10 h-6 rounded-full border transition-all",
                              studyModeEnabled
                                ? "bg-green-500/20 border-green-500/40"
                                : "bg-white/5 border-white/15"
                            )}
                          >
                            <span
                              className={cn(
                                "absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-md transition-transform duration-200",
                                studyModeEnabled ? "translate-x-4 bg-green-300" : "translate-x-0 bg-white"
                              )}
                            />
                          </button>
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={!url1.trim() || !url2.trim() || isComparing}
                        className={cn(
                          "w-full md:w-auto md:ml-auto relative group h-10 md:h-12 pl-2 pr-8 rounded-full transition-all duration-500 active:scale-[0.97] overflow-hidden",
                          url1.trim() && url2.trim() && !isComparing
                            ? "bg-[#0a0a0a] text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)_inset]"
                            : "bg-white/5 text-gray-700 cursor-not-allowed border border-white/5"
                        )}
                      >
                        <div className="relative z-10 flex items-center justify-center gap-2">
                          <div className={cn(
                            "w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-all duration-500 bg-white/5 ring-1 ring-white/10 group-hover:bg-indigo-600 group-hover:ring-indigo-400",
                            !url1.trim() || !url2.trim() ? "opacity-50" : ""
                          )}>
                            {isComparing ? (
                              <Loader2 className="w-4 h-4 animate-spin text-white/50" />
                            ) : (
                              <Scale className={cn("w-3.5 h-3.5 transition-colors", url1.trim() && url2.trim() ? "text-indigo-400 group-hover:text-white" : "text-gray-800")} />
                            )}
                          </div>
                          <span className="text-[11px] font-bold tracking-[0.1em] uppercase font-display">
                            {isComparing ? "COMPARING..." : "RELATIONAL COMPARE"}
                          </span>
                        </div>

                        {/* Premium Gradient Flow BG on Hover */}
                        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/0 via-indigo-500/10 to-purple-500/0 opacity-0 group-hover:opacity-100 translate-x-[-100%] group-hover:translate-x-[100%] transition-all duration-[1s] ease-in-out pointer-events-none" />
                      </button>
                    </div>
                    <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                      <Check className="w-3.5 h-3.5 text-blue-500/40" />
                      Temporal Syncing Enabled
                    </div>
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

          <p className="text-[10px] text-gray-700 mt-20 md:mt-8 font-bold uppercase tracking-widest opacity-30">
            ClipIQ Intelligence System • Verified Reasoning
          </p>
        </motion.div>
      </div>
    </div>
  );
}
