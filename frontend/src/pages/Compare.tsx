import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Copy,
  FlaskConical,
  Link2,
  Loader2,
  MessageSquare,
  Play,
  Scale,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import ReactPlayer from "react-player";
import { motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { compareVideos, processVideo } from "../lib/api";
import { cn } from "../lib/utils";
import { saveHistory } from "../lib/history";
import { useToast } from "../components/GlobalToast";

type ChatMessage = { id: string; role: "user" | "ai"; content: string; createdAt: number };
type Side = "A" | "B";
type Source = { timestamp: number; href?: string; side?: Side; videoId?: string };
type Parsed = {
  cleanMarkdown: string;
  all: Source[];
  a: Source[];
  b: Source[];
  unknown: Source[];
};

const DEFAULT_COMPARE_QUESTION =
  "Give a complete dual-video intelligence summary with key differences, strongest takeaways, and a clear recommendation only when learning context is valid.";
const TECH_LENS_QUESTION =
  "Give a technical lens comparison only if the videos are learning/technical. Include concept depth, clarity, and latest video by metadata date. If non-learning, clearly state that and still report which video is latest.";
const FALLBACK_ERROR = "We have some server issue. We will get back soon.";
const ACCURACY_NOTE = "ClipIQ can make mistakes. Verify important details from official sources.";
const makeMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

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
    }, 1800);
    return () => clearInterval(timer);
  }, [steps.length]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-2xl mx-auto bg-[#0a0a0a] border border-white/10 rounded-3xl p-8 relative shadow-2xl mt-12 overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[60px] pointer-events-none" />
      <div className="flex items-center gap-3 mb-8 border-b border-white/5 pb-4">
        <div className="w-3 h-3 rounded-full bg-red-500/50" />
        <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
        <div className="w-3 h-3 rounded-full bg-green-500/50" />
        <span className="text-[10px] text-gray-600 font-mono ml-2 uppercase tracking-widest flex items-center gap-2">
          ClipIQ_Engine_v2.1 <span className="w-1 h-1 rounded-full bg-gray-800" /> {status}
        </span>
      </div>
      <div className="space-y-4 font-mono text-sm leading-relaxed text-left">
        {steps.map((s, i) => (
          <motion.div
            key={s.text}
            initial={{ opacity: 0, x: -10 }}
            animate={{
              opacity: step >= i ? 1 : 0.2,
              x: step >= i ? 0 : -10,
              filter: step > i && step < steps.length ? "grayscale(0.5) opacity(0.5)" : "none",
            }}
            className="flex gap-4 items-start"
          >
            <span className="text-blue-500 shrink-0">{">"}</span>
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

function ThinkingLine() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full py-1">
      <div className="flex items-center gap-2.5 md:gap-3">
        <Sparkles className="w-5 h-5 text-blue-400/90" />
        <span className="thinking-shimmer font-semibold tracking-wide bg-clip-text text-transparent text-[15px] md:text-[16px]">
          Thinking...
        </span>
      </div>
    </motion.div>
  );
}

const extractVideoId = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "");
    if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v") || "";
  } catch {}
  return "";
};

const parseSeconds = (href: string) => {
  try {
    const parsed = new URL(href);
    const raw = parsed.searchParams.get("t");
    if (!raw) return null;
    const sec = parseInt(raw.replace(/s$/i, ""), 10);
    return Number.isFinite(sec) ? sec : null;
  } catch {
    return null;
  }
};

const formatMMSS = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

const dedupe = (sources: Source[]) => {
  const seen = new Set<string>();
  const result: Source[] = [];
  for (const source of sources) {
    const key = `${source.side || "_"}|${source.videoId || "_"}|${source.timestamp}|${source.href || "_"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
};

const parseVideoIdFromHref = (href: string) => {
  try {
    const parsed = new URL(href);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "");
    if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v") || "";
  } catch {}
  return "";
};

const parseSources = (markdown: string, urlA: string, urlB: string, fallbackSide?: Side) => {
  const idA = extractVideoId(urlA);
  const idB = extractVideoId(urlB);
  const regex = /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g;
  const sources: Source[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(markdown)) !== null) {
    const href = match[1];
    const timestamp = parseSeconds(href);
    if (timestamp === null) continue;
    const videoId = parseVideoIdFromHref(href);
    let side = fallbackSide;
    if (!side && videoId && idA && videoId === idA) side = "A";
    if (!side && videoId && idB && videoId === idB) side = "B";
    sources.push({ timestamp, href, videoId: videoId || undefined, side });
  }

  return dedupe(sources);
};

const parseEvidence = (content: string, urlA: string, urlB: string): Parsed => {
  const text = (content || "").trim();
  if (!text) return { cleanMarkdown: "", all: [], a: [], b: [], unknown: [] };

  const lines = text.split(/\r?\n/);
  const evidenceStart = lines.findIndex((line) => /^\s*##\s*(evidence links|evidence|sources)\b/i.test(line));

  if (evidenceStart < 0) {
    const all = parseSources(text, urlA, urlB);
    return { cleanMarkdown: text, all, a: [], b: [], unknown: [] };
  }

  const cleanMarkdown = lines.slice(0, evidenceStart).join("\n").trim();
  const evidenceLines = lines.slice(evidenceStart + 1);

  let currentSide: Side | undefined;
  const a: Source[] = [];
  const b: Source[] = [];
  const unknown: Source[] = [];

  for (const line of evidenceLines) {
    const low = line.toLowerCase();
    if (/\bvideo\s*a\b/.test(low) || /\ba\s*evidence\b/.test(low)) currentSide = "A";
    if (/\bvideo\s*b\b/.test(low) || /\bb\s*evidence\b/.test(low)) currentSide = "B";

    const row = parseSources(line, urlA, urlB, currentSide);
    row.forEach((src) => {
      if (src.side === "A") a.push(src);
      else if (src.side === "B") b.push(src);
      else unknown.push(src);
    });
  }

  const inline = parseSources(cleanMarkdown, urlA, urlB);
  const all = dedupe([...a, ...b, ...unknown, ...inline]);

  return { cleanMarkdown: cleanMarkdown || text, all, a: dedupe(a), b: dedupe(b), unknown: dedupe(unknown) };
};

const normalize = (raw: string) =>
  (raw || "")
    .trim()
    .replace(/^\s*STUDY_MODE\s*:\s*.+$/gim, "")
    .replace(/^\s*SHORT ANSWER\s*:\s*/gim, "## Verdict\n")
    .replace(/^\s*DECISION\s*:\s*/gim, "## Recommendation\n")
    .replace(/^\s*SOURCES\s*:\s*/gim, "## Sources\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function Compare() {
  const { showToast } = useToast();
  const location = useLocation();
  const state = location.state as any;

  const [url1, setUrl1] = useState("");
  const [url2, setUrl2] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [videoA, setVideoA] = useState<Record<string, string> | null>(null);
  const [videoB, setVideoB] = useState<Record<string, string> | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [activeTab, setActiveTab] = useState<"summary" | "chat">("summary");
  const [summaryContent, setSummaryContent] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isComparing, setIsComparing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isTechLoading, setIsTechLoading] = useState(false);

  const playerARef = useRef<any>(null);
  const playerBRef = useRef<any>(null);
  const [isPlayingA, setIsPlayingA] = useState(false);
  const [isPlayingB, setIsPlayingB] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const parsedSummary = useMemo(() => parseEvidence(summaryContent, url1, url2), [summaryContent, url1, url2]);

  useEffect(() => {
    if (!state?.restored) return;
    setUrl1(state.url1 || "");
    setUrl2(state.url2 || "");
    setSessionId(state.session_id || "");
    setVideoA(state.video_a || null);
    setVideoB(state.video_b || null);
    if (state.response) {
      setSummaryContent(normalize(state.response));
      setIsReady(true);
      setActiveTab("summary");
    }
  }, [state]);

  useEffect(() => {
    if (activeTab !== "chat") return;
    const node = chatScrollRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    });
  }, [chatMessages, activeTab, isSending]);

  const seekToSource = (source: Source) => {
    const idA = extractVideoId(url1);
    const idB = extractVideoId(url2);

    if ((source.side === "A" || (source.videoId && source.videoId === idA)) && playerARef.current) {
      playerARef.current.seekTo(source.timestamp, "seconds");
      setIsPlayingA(true);
      showToast(`Video A -> ${formatMMSS(source.timestamp)}`, "success");
      return;
    }

    if ((source.side === "B" || (source.videoId && source.videoId === idB)) && playerBRef.current) {
      playerBRef.current.seekTo(source.timestamp, "seconds");
      setIsPlayingB(true);
      showToast(`Video B -> ${formatMMSS(source.timestamp)}`, "success");
      return;
    }

    if (source.href) window.open(source.href, "_blank", "noopener,noreferrer");
  };

  const renderMarkdownTimestamp = (href?: string, children?: React.ReactNode) => {
    if (!href) return <span>{children}</span>;
    const sec = parseSeconds(href);
    if (sec === null) {
      return (
        <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 underline underline-offset-4">
          {children}
        </a>
      );
    }

    const parsed = parseSources(`[x](${href})`, url1, url2)[0] || { timestamp: sec, href };
    return (
      <button
        onClick={() => seekToSource(parsed)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/15 border border-blue-500/30 rounded-lg text-blue-300 font-mono text-[11px] font-bold hover:bg-blue-600/25 transition-all mr-2 mb-1"
      >
        <Play className="w-2.5 h-2.5 fill-current" />
        {formatMMSS(sec)}
      </button>
    );
  };

  const renderEvidence = (a: Source[], b: Source[], unknown: Source[] = []) => {
    if (a.length === 0 && b.length === 0 && unknown.length === 0) return null;

    const chip = (source: Source, index: number, side?: Side) => (
      <button
        key={`${side || source.side || "u"}-${source.timestamp}-${index}`}
        onClick={() => seekToSource(side ? { ...source, side } : source)}
        className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-600/10 border border-blue-500/30 rounded-lg text-blue-300 font-mono text-[11px] font-bold hover:bg-blue-600/20 transition-all"
      >
        <Play className="w-2.5 h-2.5 fill-current" />
        {formatMMSS(source.timestamp)}
      </button>
    );

    return (
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4 md:p-5">
        <h4 className="text-[11px] md:text-xs font-bold uppercase tracking-[0.18em] text-blue-300 mb-3">Evidence Links</h4>
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="space-y-2.5">
            <div className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">Video A</div>
            <div className="flex flex-wrap gap-2">
              {a.length > 0 ? a.slice(0, 8).map((source, index) => chip(source, index, "A")) : <span className="text-xs text-gray-500">No linked evidence</span>}
            </div>
          </div>
          <div className="space-y-2.5">
            <div className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">Video B</div>
            <div className="flex flex-wrap gap-2">
              {b.length > 0 ? b.slice(0, 8).map((source, index) => chip(source, index, "B")) : <span className="text-xs text-gray-500">No linked evidence</span>}
            </div>
          </div>
        </div>
        {unknown.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Other references</div>
            <div className="flex flex-wrap gap-2">{unknown.slice(0, 6).map((source, index) => chip(source, index))}</div>
          </div>
        )}
      </div>
    );
  };

  const handleCompare = async () => {
    if (!url1.trim() || !url2.trim() || isComparing) return;
    setIsComparing(true);
    setError("");
    setStatus("Booting pipeline");
    setSummaryContent("");
    setChatMessages([]);
    setIsReady(false);

    try {
      setStatus("Processing video A");
      const procA = await processVideo(url1.trim());
      setStatus("Processing video B");
      const procB = await processVideo(url2.trim());
      setSessionId(procA.session_id);
      setStatus("Generating summary map");

      const result = await compareVideos(procA.session_id, url1.trim(), url2.trim(), DEFAULT_COMPARE_QUESTION);
      const normalized = normalize(result.response);
      const metaA = result.video_a || { title: procA.title, channel: procA.channel, date: procA.date };
      const metaB = result.video_b || { title: procB.title, channel: procB.channel, date: procB.date };

      setVideoA(metaA);
      setVideoB(metaB);
      setSummaryContent(normalized);
      setIsReady(true);
      setActiveTab("summary");

      saveHistory({
        type: "Comparison",
        title: `Compare: ${procA.title.slice(0, 28)}... vs ${procB.title.slice(0, 28)}...`,
        channel: `${procA.channel} & ${procB.channel}`,
        date: new Date().toLocaleDateString(),
        result: { response: normalized, video_a: metaA, video_b: metaB, session_id: procA.session_id, url1: url1.trim(), url2: url2.trim(), restored: true },
      });
      showToast("Comparison summary ready", "success");
    } catch (err: any) {
      const msg = err?.message || FALLBACK_ERROR;
      setError(msg);
      showToast(msg, "error");
    } finally {
      setStatus("");
      setIsComparing(false);
    }
  };

  const handleTechnicalReview = async () => {
    if (!sessionId || !url1 || !url2 || isTechLoading || isSending) return;
    setIsTechLoading(true);
    try {
      const result = await compareVideos(sessionId, url1.trim(), url2.trim(), TECH_LENS_QUESTION);
      setSummaryContent(normalize(result.response));
      setActiveTab("summary");
      showToast("Technical review ready", "success");
    } catch (err: any) {
      const msg = err?.message || FALLBACK_ERROR;
      setError(msg);
      showToast(msg, "error");
    } finally {
      setIsTechLoading(false);
    }
  };

  const handleAsk = async () => {
    const question = chatInput.trim();
    if (!question || !sessionId || !url1 || !url2 || isSending) return;

    const userId = makeMessageId();
    const aiId = makeMessageId();
    setChatMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: question, createdAt: Date.now() },
      { id: aiId, role: "ai", content: "thinking...", createdAt: Date.now() },
    ]);
    setChatInput("");
    setIsSending(true);

    try {
      const result = await compareVideos(sessionId, url1.trim(), url2.trim(), question);
      setChatMessages((prev) => prev.map((message) => (message.id === aiId ? { ...message, content: normalize(result.response), createdAt: Date.now() } : message)));
    } catch (err: any) {
      const msg = err?.message || FALLBACK_ERROR;
      setError(msg);
      setChatMessages((prev) => prev.map((item) => (item.id === aiId ? { ...item, content: msg, createdAt: Date.now() } : item)));
    } finally {
      setIsSending(false);
    }
  };

  const resetWorkspace = () => {
    setIsReady(false);
    setSummaryContent("");
    setChatMessages([]);
    setChatInput("");
    setError("");
    setStatus("");
    setActiveTab("summary");
  };

  return (
    <div className="w-full bg-[#050505] text-white selection:bg-blue-500/30 relative pb-[72px] md:pb-8">
      <div className="p-4 md:p-6 lg:p-10 pt-4 md:pt-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl mx-auto">
          <div className="text-center mb-8 md:mb-10 space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest">Multi-video pipeline</div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight font-serif italic text-white">Intelligence Compare</h1>
            <p className="text-gray-400 max-w-2xl mx-auto text-sm md:text-base leading-relaxed">Generate summary map first, then continue in dual-video chat.</p>
          </div>

          {!isReady && (
            <>
              {!isComparing ? (
                <div className="bg-[#0f1115] border border-white/10 rounded-3xl p-4 md:p-6 lg:p-8 shadow-2xl">
                  <div className="grid md:grid-cols-2 gap-4 md:gap-5">
                    <div className="relative flex items-center bg-black/50 border border-white/10 rounded-2xl px-3 md:px-4 focus-within:border-blue-500/50 transition-all">
                      <Link2 className="w-4 h-4 text-gray-600 shrink-0" />
                      <input type="url" value={url1} onChange={(e) => setUrl1(e.target.value)} placeholder="Video A URL" className="w-full bg-transparent border-none outline-none h-12 text-sm text-white placeholder:text-gray-600 pl-3" />
                    </div>
                    <div className="relative flex items-center bg-black/50 border border-white/10 rounded-2xl px-3 md:px-4 focus-within:border-blue-500/50 transition-all">
                      <Link2 className="w-4 h-4 text-gray-600 shrink-0" />
                      <input type="url" value={url2} onChange={(e) => setUrl2(e.target.value)} placeholder="Video B URL" className="w-full bg-transparent border-none outline-none h-12 text-sm text-white placeholder:text-gray-600 pl-3" />
                    </div>
                  </div>
                  <div className="mt-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="text-[11px] text-gray-500">Inputs will hide after generation.</div>
                    <button onClick={handleCompare} disabled={!url1.trim() || !url2.trim() || isComparing} className={cn("h-11 px-6 rounded-xl text-[11px] font-bold uppercase tracking-widest inline-flex items-center justify-center gap-2 transition-all", url1.trim() && url2.trim() && !isComparing ? "bg-white text-black hover:bg-gray-100 active:scale-[0.98]" : "bg-white/10 text-gray-600 cursor-not-allowed")}>
                      <Scale className="w-4 h-4" />
                      Generate Intelligence
                    </button>
                  </div>
                </div>
              ) : (
                <ProcessingTerminal status={status || "Running"} />
              )}
              {error && <div className="mt-4 flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span></div>}
            </>
          )}

          {isReady && (
            <div className="space-y-5 md:space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-[#0f1115] border border-white/10 rounded-2xl p-4">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-blue-300 mb-2">Video A</div>
                  <div className="aspect-video rounded-xl overflow-hidden border border-white/10 bg-black">{url1 ? <ReactPlayer ref={playerARef} url={url1} width="100%" height="100%" controls={true} playing={isPlayingA} onPlay={() => setIsPlayingA(true)} onPause={() => setIsPlayingA(false)} config={{ youtube: { playerVars: { modestbranding: 1, rel: 0 } } }} /> : null}</div>
                  <p className="mt-3 text-sm md:text-base font-semibold text-white line-clamp-2">{videoA?.title || "Video A"}</p>
                </div>
                <div className="bg-[#0f1115] border border-white/10 rounded-2xl p-4">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-blue-300 mb-2">Video B</div>
                  <div className="aspect-video rounded-xl overflow-hidden border border-white/10 bg-black">{url2 ? <ReactPlayer ref={playerBRef} url={url2} width="100%" height="100%" controls={true} playing={isPlayingB} onPlay={() => setIsPlayingB(true)} onPause={() => setIsPlayingB(false)} config={{ youtube: { playerVars: { modestbranding: 1, rel: 0 } } }} /> : null}</div>
                  <p className="mt-3 text-sm md:text-base font-semibold text-white line-clamp-2">{videoB?.title || "Video B"}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 bg-[#0f1115] border border-white/10 rounded-2xl p-2">
                <button onClick={() => setActiveTab("summary")} className={cn("h-11 rounded-xl text-[10px] md:text-[11px] font-bold uppercase tracking-[0.1em] whitespace-nowrap flex items-center justify-center gap-1.5 px-2 transition-all", activeTab === "summary" ? "bg-blue-600 text-white border border-blue-500/40" : "text-gray-400 hover:text-white")}><Sparkles className="w-3.5 h-3.5" />Summary</button>
                <button onClick={() => setActiveTab("chat")} className={cn("h-11 rounded-xl text-[10px] md:text-[11px] font-bold uppercase tracking-[0.1em] whitespace-nowrap flex items-center justify-center gap-1.5 px-2 transition-all", activeTab === "chat" ? "bg-blue-600 text-white border border-blue-500/40" : "text-gray-400 hover:text-white")}><MessageSquare className="w-3.5 h-3.5" />Chat</button>
                <button onClick={resetWorkspace} className="h-11 rounded-xl border border-white/10 text-[10px] md:text-[11px] font-bold uppercase tracking-[0.1em] whitespace-nowrap text-gray-300 hover:text-white hover:border-blue-500/40 px-2 transition-all">New</button>
              </div>

              <div className="flex justify-end"><button onClick={handleTechnicalReview} disabled={isTechLoading || isSending} className="h-9 px-4 rounded-xl border border-blue-500/30 bg-blue-600/10 text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300 hover:bg-blue-600/20 disabled:opacity-40 inline-flex items-center gap-2"><FlaskConical className="w-3.5 h-3.5" />{isTechLoading ? "Loading..." : "Technical Review"}</button></div>

              {activeTab === "summary" ? (
                <div className="bg-[#0c0f15] border border-white/10 rounded-3xl overflow-hidden flex flex-col h-[68dvh] min-h-[560px]">
                  <div className="px-5 py-4 md:px-7 md:py-5 flex items-center justify-between border-b border-white/10">
                    <div>
                      <h3 className="text-lg md:text-2xl font-serif italic text-blue-400 font-bold">Executive Comparison Summary</h3>
                      <p className="mt-1 text-[10px] text-gray-500 uppercase tracking-widest">Dual-video intelligence map</p>
                    </div>
                    <button onClick={() => { navigator.clipboard.writeText(parsedSummary.cleanMarkdown || ""); showToast("Summary copied", "success"); }} className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white transition-all"><Copy className="w-4 h-4" /></button>
                  </div>

                  <div data-lenis-prevent className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain custom-scrollbar px-5 md:px-7 py-5 md:py-6" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
                    <div className="prose prose-invert prose-sm md:prose-base max-w-none text-gray-200 leading-relaxed">
                      <ReactMarkdown components={{ h2: ({ children }) => <h2 className="text-white mt-7 mb-3">{children}</h2>, p: ({ children }) => <p className="mb-4">{children}</p>, li: ({ children }) => <li className="my-2">{children}</li>, a: ({ href, children }) => renderMarkdownTimestamp(href, children) }}>{parsedSummary.cleanMarkdown}</ReactMarkdown>
                    </div>
                    {renderEvidence(parsedSummary.a, parsedSummary.b, parsedSummary.unknown)}
                    <p className="mt-5 text-[10px] text-gray-500">{ACCURACY_NOTE}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-[#070707] rounded-3xl border border-white/10 flex flex-col overflow-hidden h-[68dvh] min-h-[560px]">
                  <div ref={chatScrollRef} data-lenis-prevent className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain custom-scrollbar px-4 py-5 md:px-6 md:py-6 space-y-8" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
                    {chatMessages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center py-12 md:py-16">
                        <div className="w-14 h-14 rounded-2xl border border-blue-500/30 bg-blue-500/10 flex items-center justify-center mb-4"><MessageSquare className="w-7 h-7 text-blue-400" /></div>
                        <p className="text-sm font-semibold text-white">Ask questions across both videos</p>
                        <p className="text-xs text-gray-500 mt-2">Try: Which one has better learning depth?</p>
                      </div>
                    ) : (
                      chatMessages.map((message) => {
                        if (message.role === "ai" && message.content === "thinking...") return <ThinkingLine key={message.id} />;
                        const parsed = parseEvidence(message.content, url1, url2);
                        return (
                          <motion.div key={message.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={cn("flex w-full", message.role === "user" ? "justify-end" : "justify-start")}>
                            {message.role === "ai" && <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mr-3 mt-1 shrink-0"><Sparkles className="w-4 h-4 text-blue-300" /></div>}
                            <div className={cn("flex flex-col gap-3 min-w-0", message.role === "user" ? "max-w-[56%]" : "max-w-[92%]")}>
                              <div className={cn("px-5 py-4 rounded-[1.25rem] break-words whitespace-pre-wrap [overflow-wrap:anywhere]", message.role === "user" ? "bg-blue-600 text-white rounded-tr-none" : "bg-[#111113] border border-white/10 text-gray-200 rounded-tl-none")}>
                                <div className="prose prose-invert prose-sm max-w-none"><ReactMarkdown components={{ p: ({ children }) => <p className="m-0 mb-3 last:mb-0">{children}</p>, li: ({ children }) => <li className="my-1.5">{children}</li>, a: ({ href, children }) => renderMarkdownTimestamp(href, children) }}>{parsed.cleanMarkdown}</ReactMarkdown></div>
                              </div>
                              {message.role === "ai" && renderEvidence(parsed.a, parsed.b, parsed.unknown)}
                              {message.role === "ai" && (
                                <div className="flex items-center gap-2 text-[10px] text-gray-400 ml-1">
                                  <button onClick={() => { navigator.clipboard.writeText(parsed.cleanMarkdown || message.content); showToast("Copied to clipboard", "success"); }} className="inline-flex items-center gap-1 text-gray-500 hover:text-white transition-colors"><Copy className="w-3.5 h-3.5" />Copy</button>
                                  <span className="h-3 w-px bg-white/10" />
                                  <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
                                </div>
                              )}
                            </div>
                            {message.role === "user" && <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center ml-3 mt-1 shrink-0"><User className="w-4 h-4 text-blue-300" /></div>}
                          </motion.div>
                        );
                      })
                    )}
                  </div>

                  <div className="shrink-0 p-3 md:p-4 border-t border-white/5">
                    <div className="w-full flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-[1.25rem] px-3 p-1.5 focus-within:border-blue-500/40 transition-all">
                      <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAsk(); } }} placeholder="Ask about both videos..." className="flex-1 bg-transparent border-none outline-none py-2 text-[14px] text-white placeholder:text-gray-700" disabled={isSending} />
                      <button onClick={handleAsk} disabled={!chatInput.trim() || isSending} className="w-8 h-8 flex items-center justify-center bg-blue-600/80 text-white rounded-full disabled:opacity-20 active:scale-95"><Send className="w-3.5 h-3.5 fill-white text-white" /></button>
                    </div>
                    <p className="mt-2 px-1 text-center text-[10px] text-gray-500">{ACCURACY_NOTE}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
