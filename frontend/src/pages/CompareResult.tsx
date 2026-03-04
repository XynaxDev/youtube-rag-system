import { useEffect, useMemo, useRef, useState } from "react";
import {
    Copy,
    MessageSquare,
    Play,
    Scale,
    Send,
    Sparkles,
    User,
    ArrowLeft,
    Check,
    Share2,
    Zap
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import ReactPlayer from "react-player";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { compareVideos, checkTechnicalVideos } from "../lib/api";
import { cn } from "../lib/utils";
import { useToast } from "../components/GlobalToast";

type ChatMessage = { id: string; role: "user" | "ai"; content: string; createdAt: number; sources?: Array<{ timestamp: number; video_id: string }>; targetSide?: "A" | "B" | "BOTH" };
type Side = "A" | "B";
type Source = { timestamp: number; href?: string; side?: Side; videoId?: string };
type Parsed = {
    cleanMarkdown: string;
    all: Source[];
    a: Source[];
    b: Source[];
    unknown: Source[];
};

/* ---------- Tooltip helpers (matching SummaryResult) ---------- */
function Tooltip({ text, children, align = "center" }: { text: string; children: React.ReactNode; align?: "left" | "right" | "center" }) {
    const posClass =
        align === "right" ? "right-0" :
            align === "center" ? "left-1/2 -translate-x-1/2" :
                "left-0";
    return (
        <div className="group relative flex items-center justify-center">
            {children}
            <div className={cn(
                "absolute bottom-full mb-3 px-3 py-1.5 bg-[#0f1115] border border-white/10 rounded-lg text-[10px] text-white font-bold opacity-0 group-hover:opacity-100 transition-all pointer-events-none shadow-2xl z-[200] uppercase tracking-widest scale-95 group-hover:scale-100 origin-bottom min-w-[100px] max-w-[200px] text-center whitespace-nowrap",
                posClass
            )}>{text}</div>
        </div>
    );
}

function TooltipBelow({ text, children, align = "left" }: { text: string; children: React.ReactNode; align?: "left" | "right" | "center" }) {
    const posClass =
        align === "right" ? "right-0" :
            align === "center" ? "left-1/2 -translate-x-1/2" :
                "left-0";
    return (
        <div className="group relative flex items-center justify-center">
            {children}
            <div className={cn(
                "absolute top-full mt-3 px-3 py-1.5 bg-[#0f1115] border border-white/10 rounded-lg text-[10px] text-white font-bold opacity-0 group-hover:opacity-100 transition-all pointer-events-none shadow-2xl z-[200] uppercase tracking-widest scale-95 group-hover:scale-100 origin-top min-w-[100px] max-w-[200px] text-center whitespace-nowrap",
                posClass
            )}>{text}</div>
        </div>
    );
}

/* --- ThinkingLine: exact copy from SummaryResult --- */
function ThinkingLine({ compact = false }: { compact?: boolean }) {
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full py-1">
            <div className="flex items-center gap-2.5 md:gap-3">
                <Sparkles className={cn("text-blue-400/90", compact ? "w-4 h-4" : "w-5 h-5")} />
                <span className={cn(
                    "thinking-shimmer font-semibold tracking-wide bg-clip-text text-transparent",
                    compact ? "text-[14px]" : "text-[15px] md:text-[16px]",
                )}>
                    Thinking...
                </span>
            </div>
        </motion.div>
    );
}

const hideScrollbarCSS = `
  .hide-scrollbar::-webkit-scrollbar { display: none; }
  .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  .scrollbar-hide::-webkit-scrollbar { display: none; }
  .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
`;

const FALLBACK_ERROR = "We have some server issue. We will get back soon.";
const ACCURACY_NOTE = "ClipIQ can make mistakes. Verify important details from official sources.";
const makeMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/* ---------- Utils ---------- */
const extractVideoId = (url: string) => {
    try {
        const parsed = new URL(url);
        if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "");
        if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v") || "";
    } catch { }
    return "";
};

const parseSeconds = (href: string) => {
    try {
        const parsed = new URL(href);
        const raw = parsed.searchParams.get("t");
        if (!raw) return null;
        const sec = parseInt(raw.replace(/s$/i, ""), 10);
        return Number.isFinite(sec) ? sec : null;
    } catch { return null; }
};

const formatMMSS = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

const dedupe = (sources: Source[]) => {
    const seen = new Set<string>();
    const result: Source[] = [];
    for (const source of sources) {
        const key = `${source.side || "_"}|${source.timestamp}|${source.href || "_"}`;
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
    } catch { }
    return "";
};

const parseSources = (markdown: string, urlA: string, urlB: string, fallbackSide?: Side) => {
    const idA = extractVideoId(urlA);
    const idB = extractVideoId(urlB);
    const regex = /\[[^\]]+\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g;
    const sources: Source[] = [];
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(markdown)) !== null) {
        const href = match[1];
        const timestamp = parseSeconds(href);
        if (timestamp === null) continue;
        const videoId = parseVideoIdFromHref(href);
        let side = fallbackSide;
        if (!side && videoId) {
            if (idA && videoId === idA) side = "A";
            else if (idB && videoId === idB) side = "B";
        }
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
    compactStandaloneTimestampLines(
        dedupeRepeatedTimestampLinks(
        (raw || "")
            .trim()
            .replace(/^\s*STUDY_MODE\s*:\s*.+$/gim, "")
            .replace(/^\s*SHORT ANSWER\s*:\s*/gim, "## Verdict\n")
            .replace(/^\s*DECISION\s*:\s*/gim, "## Recommendation\n")
            .replace(/^\s*SOURCES\s*:\s*/gim, "## Sources\n")
            .replace(/^\s*,\s*$/gim, "")
            .replace(/((?:\*\*)?(?:key points|key takeaways|focus moments|study plan|recommendation)(?:\*\*)?:)\s*\n{2,}(?=[-*])/gim, "$1\n")
            .replace(/\n{3,}/g, "\n\n"))
            .trim()
    );

function dedupeRepeatedTimestampLinks(markdown: string): string {
    if (!markdown) return markdown;
    const pattern = /\[(\d{1,2}:[0-5]\d)\]\(\s*(https?:\/\/youtu\.be\/[^\s)]+)\s*\)/gi;
    const seen = new Set<string>();
    return markdown.replace(pattern, (_match, stamp, url) => {
        const normalized = String(url || "").trim().toLowerCase();
        if (seen.has(normalized)) return "";
        seen.add(normalized);
        return `[${stamp}](${String(url).trim()})`;
    }).replace(/[ \t]{2,}/g, " ");
}

function compactStandaloneTimestampLines(markdown: string): string {
    if (!markdown) return markdown;
    const timestampOnlyLine = /^\s*\[\d{1,2}:[0-5]\d\]\(https?:\/\/youtu\.be\/[^\s)]+\)\s*$/i;
    const lines = markdown.split(/\r?\n/);
    const out: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "," || trimmed === "'" || trimmed === "\"") {
            if (trimmed === "," || trimmed === "'" || trimmed === "\"") continue;
            out.push(line);
            continue;
        }
        if (timestampOnlyLine.test(trimmed) && out.length > 0) {
            let idx = out.length - 1;
            while (idx >= 0 && !out[idx].trim()) idx -= 1;
            if (idx >= 0) {
                out[idx] = `${out[idx].trimEnd()} ${trimmed}`;
                continue;
            }
        }
        out.push(line);
    }
    return out.join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/([.!?])\s*\n(\[\d{1,2}:[0-5]\d\]\(https?:\/\/youtu\.be\/[^\s)]+\))/gi, "$1 $2")
        .trim();
}

const linkifyBareTimestamps = (
    markdown: string,
    urlA: string,
    urlB: string,
    defaultTarget: "A" | "B" | "BOTH" = "BOTH",
) => {
    const idA = extractVideoId(urlA);
    const idB = extractVideoId(urlB);
    if (!markdown) return "";

    const lines = markdown.split(/\r?\n/);
    let activeSide: Side | undefined =
        defaultTarget === "A" ? "A" : defaultTarget === "B" ? "B" : undefined;

    const linked = lines.map((line) => {
        const lower = line.toLowerCase();
        if (/\bvideo\s*a\b|\bvdo\s*a\b/.test(lower)) activeSide = "A";
        if (/\bvideo\s*b\b|\bvdo\s*b\b/.test(lower)) activeSide = "B";

        return line.replace(/\[(\d{1,2}):([0-5]\d)\](?!\()/g, (_match, mm, ss) => {
            const minutes = Number(mm);
            const seconds = Number(ss);
            if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return _match;
            const totalSeconds = minutes * 60 + seconds;

            let side: Side | undefined = activeSide;
            if (!side && defaultTarget === "A") side = "A";
            if (!side && defaultTarget === "B") side = "B";

            const targetVideoId = side === "B" ? idB : idA;
            if (!targetVideoId) return _match;
            const stamp = `${minutes}:${seconds.toString().padStart(2, "0")}`;
            const link = `https://youtu.be/${targetVideoId}?t=${totalSeconds}s`;
            return `[${stamp}](${link})`;
        });
    });

    return linked.join("\n");
};

const formatClockTime = (ts?: number) => {
    if (!ts) return "";
    const value = new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
    return value.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
};

/* ---------- Detect if the user's chat is targeting one video or both ---------- */
type ChatTarget = "A" | "B" | "BOTH";
const COMPARISON_QUERY_REGEX =
    /\b(compare|comparison|better|best|worse|vs|versus|difference|different|unified\s+verdict|which\s+video|which\s+one|cross[-\s]?video)\b/i;

function isComparisonQuestion(question: string): boolean {
    return COMPARISON_QUERY_REGEX.test(question || "");
}

function shouldForceDualCompare(question: string, target: ChatTarget): boolean {
    // Explicit single-video scope should not be overridden by comparative keywords like "best".
    if (target === "A" || target === "B") return false;
    return isComparisonQuestion(question);
}

function detectChatTarget(question: string): ChatTarget {
    const lower = question.toLowerCase();
    const mentionsA = /\bvideo\s*a\b|1st\s*video|first\s*video|\bvdo\s*a\b|\bstream\s*a\b/i.test(lower);
    const mentionsB = /\bvideo\s*b\b|2nd\s*video|second\s*video|\bvdo\s*b\b|\bstream\s*b\b/i.test(lower);
    if (mentionsA && mentionsB) return "BOTH";
    if (mentionsA && !mentionsB) return "A";
    if (mentionsB && !mentionsA) return "B";
    return "BOTH";
}

export function CompareResult() {
    const { showToast } = useToast();
    const location = useLocation();
    const navigate = useNavigate();
    const state = location.state as any;

    const [url1] = useState(state?.url1 || "");
    const [url2] = useState(state?.url2 || "");
    const [sessionId] = useState(state?.session_id || "");
    const [videoA] = useState<Record<string, string> | null>(state?.video_a || null);
    const [videoB] = useState<Record<string, string> | null>(state?.video_b || null);
    const initialStudyMode = Boolean(state?.study_mode);

    const [activeTab, setActiveTab] = useState<"summary" | "chat">("summary");
    const [summaryContent, setSummaryContent] = useState(
        linkifyBareTimestamps(normalize(state?.response || ""), state?.url1 || "", state?.url2 || "", "BOTH")
    );
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");

    const [isSending, setIsSending] = useState(false);
    const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);

    // Study Mode
    const [isStudyMode, setIsStudyMode] = useState(initialStudyMode);
    const [isCheckingTech, setIsCheckingTech] = useState(false);
    const [supportsStudyMode, setSupportsStudyMode] = useState(initialStudyMode);

    const playerARef = useRef<any>(null);
    const playerBRef = useRef<any>(null);
    const [isPlayingA, setIsPlayingA] = useState(false);
    const [isPlayingB, setIsPlayingB] = useState(false);
    const mobileChatScrollRef = useRef<HTMLDivElement>(null);
    const desktopChatScrollRef = useRef<HTMLDivElement>(null);
    const mobileChatEndRef = useRef<HTMLDivElement>(null);
    const desktopChatEndRef = useRef<HTMLDivElement>(null);

    const parsedSummary = useMemo(() => parseEvidence(summaryContent, url1, url2), [summaryContent, url1, url2]);

    useEffect(() => {
        if (!state) { navigate("/compare", { replace: true }); return; }
    }, [state, navigate]);

    useEffect(() => {
        const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        if (!sessionId || !url1 || !url2) return;
        let cancelled = false;
        setIsCheckingTech(true);
        checkTechnicalVideos(sessionId, url1, url2)
            .then((res) => {
                if (cancelled) return;
                const isTechnical = Boolean(res?.is_technical);
                setSupportsStudyMode(isTechnical || initialStudyMode);
                if (!isTechnical && !initialStudyMode) setIsStudyMode(false);
            })
            .catch(() => {
                if (cancelled) return;
                setSupportsStudyMode(initialStudyMode);
                if (!initialStudyMode) setIsStudyMode(false);
            })
            .finally(() => {
                if (!cancelled) setIsCheckingTech(false);
            });

        return () => {
            cancelled = true;
        };
    }, [sessionId, url1, url2, initialStudyMode]);

    useEffect(() => {
        if (activeTab !== "chat") return;
        const activeChatScroller = isDesktop ? desktopChatScrollRef.current : mobileChatScrollRef.current;
        if (activeChatScroller) {
            activeChatScroller.scrollTo({ top: activeChatScroller.scrollHeight, behavior: "smooth" });
        }
    }, [chatMessages, activeTab, isDesktop]);

    const seekToSource = (source: Source) => {
        const idA = extractVideoId(url1);
        const idB = extractVideoId(url2);
        if ((source.side === "A" || (source.videoId && source.videoId === idA)) && playerARef.current) {
            playerARef.current.seekTo(source.timestamp, "seconds");
            setIsPlayingA(true);
            showToast(`Seeking to ${formatMMSS(source.timestamp)}`, "success");
            return;
        }
        if ((source.side === "B" || (source.videoId && source.videoId === idB)) && playerBRef.current) {
            playerBRef.current.seekTo(source.timestamp, "seconds");
            setIsPlayingB(true);
            showToast(`Seeking to ${formatMMSS(source.timestamp)}`, "success");
            return;
        }
        if (source.href) window.open(source.href, "_blank", "noopener,noreferrer");
    };

    const renderMarkdownTimestamp = (href?: string, children?: React.ReactNode) => {
        if (!href) return <span>{children}</span>;
        const sec = parseSeconds(href);
        if (sec === null) return <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 font-bold underline decoration-blue-500/40 underline-offset-4 hover:text-white transition-all">{children}</a>;
        const idA = extractVideoId(url1);
        const idB = extractVideoId(url2);
        const parsed = parseSources(`[x](${href})`, url1, url2)[0] || { timestamp: sec, href };
        const linkVideoId = parseVideoIdFromHref(href);
        const effectiveSide: Side | undefined =
            parsed.side ||
            (linkVideoId && idA && linkVideoId === idA ? "A" : undefined) ||
            (linkVideoId && idB && linkVideoId === idB ? "B" : undefined);
        return (
            <span className="group relative inline-flex align-baseline ml-1">
                <button
                    type="button"
                    onClick={() => seekToSource(parsed)}
                    className={cn(
                        "text-white font-mono font-bold inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all text-[11px]",
                        effectiveSide === "B"
                            ? "bg-purple-600/20 hover:bg-purple-600/40 border-purple-500/30"
                            : "bg-blue-600/20 hover:bg-blue-600/40 border-blue-500/30"
                    )}
                >
                    <Play className="w-3 h-3 fill-white" />
                    <span>{formatMMSS(sec)}</span>
                </button>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 bg-[#0f1115] border border-white/10 rounded-md text-[10px] text-white font-bold opacity-0 group-hover:opacity-100 transition-all pointer-events-none shadow-2xl z-[210] whitespace-nowrap">
                    {`Seek to ${formatMMSS(sec)}`}
                </span>
            </span>
        );
    };

    const handleCopy = async () => {
        try { await navigator.clipboard.writeText(summaryContent); showToast("Summary copied successfully", "success"); }
        catch { showToast("Failed to copy", "error"); }
    };

    const handleShare = async () => {
        try { await navigator.clipboard.writeText(window.location.href); showToast("Page URL copied", "success"); }
        catch { showToast("Failed to copy URL", "error"); }
    };

    /**
     * Chat handler: Routes to the correct API based on intent.
     * - If user asks about Video A specifically → chatWithVideo using url1
     * - If user asks about Video B specifically → chatWithVideo using url2
     * - If user asks about both or a comparison → compareVideos
     */
    const handleAsk = async (overrideQuestion?: string) => {
        const question = (overrideQuestion || chatInput).trim();
        if (!question || !sessionId || isSending) return;

        const userId = makeMessageId();
        const aiId = makeMessageId();
        const target = detectChatTarget(question);
        const forceDualCompare = shouldForceDualCompare(question, target);
        const effectiveTarget: ChatTarget = forceDualCompare ? "BOTH" : target;
        setChatMessages((prev) => [...prev,
        { id: userId, role: "user", content: question, createdAt: Date.now() },
        { id: aiId, role: "ai", content: "thinking...", createdAt: Date.now(), targetSide: effectiveTarget },
        ]);
        setChatInput("");
        setIsSending(true);

        try {
            let responseText = "";
            const responseSources: Array<{ timestamp: number; video_id: string }> = [];

            // Always use dual-video chat pipeline on compare page.
            // Literal scope (Video A/Video B/BOTH) is handled in backend.
            const result = await compareVideos(sessionId, url1.trim(), url2.trim(), question, isStudyMode, true);
            responseText = result.response;

            const finalContent = linkifyBareTimestamps(normalize(responseText), url1, url2, effectiveTarget);
            setChatMessages((prev) => prev.map((m) =>
                m.id === aiId ? { ...m, content: finalContent, sources: responseSources, targetSide: effectiveTarget, createdAt: Date.now() } : m
            ));

            // Auto-seek for single-video responses with sources
            if (responseSources.length > 0) {
                const ts = responseSources[0].timestamp;
                const vid = responseSources[0].video_id;
                const idA = extractVideoId(url1);
                const idB = extractVideoId(url2);
                if (target === "A" || vid === idA) {
                    playerARef.current?.seekTo(ts, "seconds");
                    setIsPlayingA(true);
                } else if (target === "B" || vid === idB) {
                    playerBRef.current?.seekTo(ts, "seconds");
                    setIsPlayingB(true);
                }
            }
        } catch (err: any) {
            setChatMessages((prev) => prev.map((item) =>
                item.id === aiId ? { ...item, content: err?.message || FALLBACK_ERROR, createdAt: Date.now() } : item
            ));
        } finally { setIsSending(false); }
    };

    /* ---------- Shared Renderers ---------- */
    const renderSummaryContent = () => (
        <>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                <div>
                    <h3 className="text-sm font-serif italic text-blue-400 font-bold">Dual-Video Contrast Report</h3>
                    <div className="text-[9px] text-gray-500 font-mono font-bold uppercase tracking-widest flex items-center gap-2 mt-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        Cross-Stream Verified <Check className="w-3 h-3 text-green-500" />
                    </div>
                </div>
                <button onClick={handleCopy} className="p-2.5 bg-white/[0.03] hover:bg-white/[0.08] rounded-xl border border-white/10 text-gray-400">
                    <Copy className="w-4 h-4" />
                </button>
            </div>
            <div className="prose prose-invert prose-sm max-w-none pb-14 text-sans leading-relaxed text-[14px]">
                <ReactMarkdown components={{
                    h1: ({ children }) => <h1 className="text-white font-bold text-xl mt-6 mb-3 font-serif">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-white font-bold text-lg mt-5 mb-2 font-serif">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-blue-300 font-bold text-base mt-4 mb-2 font-serif italic">{children}</h3>,
                    p: ({ children }) => <p className="mb-4 text-gray-300 leading-relaxed">{children}</p>,
                    strong: ({ children }) => <strong className="text-white font-bold">{children}</strong>,
                    ul: ({ children }) => <ul className="mb-4 list-none p-0 space-y-1.5">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-4 list-none p-0 space-y-1.5">{children}</ol>,
                    li: ({ children }) => (
                        <li className="flex gap-3 items-start">
                            <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-1" />
                            <span className="leading-relaxed text-gray-300">{children}</span>
                        </li>
                    ),
                    a: ({ href, children }) => renderMarkdownTimestamp(href, children),
                }}>{parsedSummary.cleanMarkdown}</ReactMarkdown>
            </div>
            <p className="mt-2 text-[10px] text-gray-500 leading-relaxed">{ACCURACY_NOTE}</p>
        </>
    );

    const renderChatMessage = (msg: ChatMessage) => {
        if (msg.role === "ai" && msg.content === "thinking...") return <ThinkingLine key={msg.id} compact />;
        const parsed = parseEvidence(msg.content, url1, url2);
        const defaultTarget = msg.targetSide || "BOTH";
        const markdownToRender = linkifyBareTimestamps(parsed.cleanMarkdown, url1, url2, defaultTarget);
        return (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} key={msg.id}
                className={cn("flex w-full group/msg", msg.role === "user" ? "justify-end" : "justify-start")}>
                {msg.role === "ai" && (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/5 border border-white/10 flex items-center justify-center mr-3 mt-1 shrink-0 shadow-lg">
                        <Sparkles className="w-4 h-4 text-blue-400" />
                    </div>
                )}
                <div className={cn("flex flex-col min-w-0 gap-2", msg.role === "user" ? "max-w-[50%] items-end ml-auto" : "max-w-[92%] items-start")}>
                    <div className={cn(
                        "px-5 py-4 rounded-[1.25rem] shadow-xl relative transition-all w-fit min-w-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
                        msg.role === "user"
                            ? "bg-blue-600 text-white rounded-tr-none font-medium text-[14px]"
                            : "bg-[#111113] border border-white/10 text-gray-200 rounded-tl-none text-[14px] leading-relaxed"
                    )}>
                        <ReactMarkdown components={{
                            p: ({ children }) => <p className="m-0">{children}</p>,
                            ul: ({ children }) => <ul className="m-0 list-none p-0 space-y-1.5">{children}</ul>,
                            h1: ({ children }) => <span className="block text-white font-bold text-base mt-3 mb-1 font-serif">{children}</span>,
                            h2: ({ children }) => <span className="block text-white font-bold text-[15px] mt-3 mb-1 font-serif">{children}</span>,
                            h3: ({ children }) => <span className="block text-blue-300 font-bold text-[14px] mt-2 mb-1 font-serif italic">{children}</span>,
                            li: ({ children }) => (
                                <li className="flex gap-2.5 items-start mb-1 last:mb-0">
                                    <Sparkles className="w-3.5 h-3.5 text-blue-500/40 shrink-0 mt-1" />
                                    <span className="text-[13px] leading-relaxed text-gray-300">{children}</span>
                                </li>
                            ),
                            a: ({ href, children }) => renderMarkdownTimestamp(href, children),
                        }}>{
                                markdownToRender
                                    .replace(/^\s*Source:\s*$/gim, "")
                            }</ReactMarkdown>
                    </div>
                    {msg.role === "ai" && msg.content !== "thinking..." && (
                        <div className="flex items-center gap-2 mt-2 ml-1 flex-wrap">
                            <Tooltip text="Copy response" align="left">
                                <button onClick={() => { navigator.clipboard.writeText(msg.content); showToast("Copied", "success"); }}
                                    className="p-1.5 text-gray-500 hover:text-white transition-colors">
                                    <Copy className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                </button>
                            </Tooltip>
                            <div className="h-3 w-px bg-white/10 mx-px" />
                            <span className="text-[10px] font-mono font-bold tracking-wide text-gray-400">{formatClockTime(msg.createdAt)}</span>
                        </div>
                    )}
                </div>
                {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center ml-3 mt-1 shrink-0 shadow-lg">
                        <User className="w-4 h-4 text-blue-400" />
                    </div>
                )}
            </motion.div>
        );
    };

    const starterQuestions = supportsStudyMode
        ? [
            "Why was Video A better?",
            "Compare technical depth.",
            "What's the unified verdict?",
        ]
        : [
            "What is common in both videos?",
            "How do Video A and B differ?",
            "Which moments matter most?",
        ];

    const renderChatEmpty = () => (
        <div className="h-full flex flex-col items-center justify-center text-center py-12 md:py-20 pt-16 md:pt-12 px-6">
            <div className="w-16 h-16 aspect-square rounded-[1.5rem] border border-blue-500/30 bg-blue-500/10 flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(59,130,246,0.2)]">
                <MessageSquare className="w-8 h-8 text-blue-400" />
            </div>
            <h4 className="text-lg font-bold mb-3 font-display tracking-widest text-white uppercase">ClipIQ Interface Ready</h4>
            <p className="text-[10px] max-w-[280px] font-bold uppercase tracking-[0.24em] text-blue-300/90 mb-3 mx-auto">Ask about specific timestamps, context, or hidden insights</p>
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
                {supportsStudyMode && (
                    <button onClick={() => handleAsk("Run deep technical analysis and comparison on both videos.")}
                        disabled={isSending || isCheckingTech}
                        className="px-4 py-2 bg-blue-600 text-white border border-blue-500 text-[10px] font-bold rounded-full active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2 shadow-[0_0_20px_rgba(59,130,246,0.3)]">
                        <Scale className="w-3.5 h-3.5" /> Analyze Deep
                    </button>
                )}
                {starterQuestions.map((q) => (
                    <button key={q} onClick={() => handleAsk(q)}
                        className="px-4 py-2 bg-white/5 hover:bg-blue-600/20 border border-white/10 hover:border-blue-500 text-[10px] font-bold text-gray-400 hover:text-white rounded-full transition-all active:scale-95 disabled:opacity-50"
                        disabled={isSending}>{q}</button>
                ))}
            </div>
        </div>
    );

    const renderChatInput = () => (
        <div className="shrink-0 px-3 pb-3 pt-0 md:px-4 md:pb-4 md:pt-0 bg-transparent max-w-4xl mx-auto w-full">
            <div className={cn(
                "w-full mx-auto relative flex items-center gap-2 bg-white/[0.04] border rounded-[1.25rem] px-3 transition-all shadow-inner p-1.5",
                isStudyMode ? "border-green-500/50 focus-within:border-green-400" : "border-white/10 focus-within:border-blue-500/40"
            )}>
                <textarea
                    data-lenis-prevent
                    value={chatInput}
                    onChange={(e) => { setChatInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'; }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); (e.target as HTMLTextAreaElement).style.height = 'auto'; } }}
                    placeholder="Ask anything about the videos..."
                    rows={1}
                    className="flex-1 self-end bg-transparent border-none outline-none py-2 px-1 text-[14px] leading-relaxed text-white placeholder:text-gray-600 focus:ring-0 resize-none max-h-[100px] overflow-y-auto touch-auto"
                    disabled={isSending}
                />

                <button onClick={() => handleAsk()} disabled={!chatInput.trim() || isSending}
                    className={cn(
                        "w-8 h-8 flex items-center justify-center text-white rounded-full disabled:opacity-20 active:scale-95 shrink-0 shadow-lg self-center transition-colors",
                        supportsStudyMode && isStudyMode ? "bg-green-600/80 hover:bg-green-500" : "bg-blue-600/80 hover:bg-blue-500"
                    )}>
                    <Send className="w-3.5 h-3.5 fill-white text-white" />
                </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-gray-500 leading-relaxed font-mono">{ACCURACY_NOTE}</p>
        </div>
    );

    if (!state) {
        return (
            <div className="h-screen bg-[#050505] text-white flex items-center justify-center flex-col gap-4">
                <p className="text-gray-400 font-display text-sm tracking-widest uppercase">Intelligence state not found. Please initiate a new analysis.</p>
                <button onClick={() => navigate("/compare")} className="px-8 py-4 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95">
                    Initialize Analysis
                </button>
            </div>
        );
    }

    return (
        <>
            <style>{hideScrollbarCSS}</style>

            <div className="w-full h-full flex flex-col bg-[#050505] text-white selection:bg-blue-500/30 font-sans relative pb-[72px] lg:pb-0 overflow-x-hidden">

                {/* Top Header (Sticky) — same as SummaryResult */}
                <div className="sticky top-0 z-[150] shrink-0 bg-[#050505]/80 backdrop-blur-xl px-4 md:px-6 py-3 md:py-4 flex items-center justify-between border-b border-white/5">
                    <TooltipBelow text="Back to Hub" align="left">
                        <button onClick={() => navigate(-1)} className="p-2 md:p-2.5 hover:bg-white/5 rounded-2xl transition-all group border border-transparent hover:border-white/10">
                            <ArrowLeft className="w-5 h-5 text-gray-400 group-hover:text-white" />
                        </button>
                    </TooltipBelow>

                    <div className="flex flex-col items-center">
                        <h2 className="text-[11px] font-bold tracking-widest uppercase font-display text-blue-400 bg-blue-500/5 px-4 py-1.5 rounded-full border border-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.1)]">ClipIQ Platform Console</h2>
                    </div>

                    <div className="flex items-center gap-3">
                        <TooltipBelow text="Copy Page URL" align="right">
                            <button onClick={handleShare} className="p-2.5 bg-white/5 hover:bg-white/10 rounded-2xl transition-all group border border-white/5 shadow-xl">
                                <Share2 className="w-5 h-5 text-gray-400 group-hover:text-white" />
                            </button>
                        </TooltipBelow>
                    </div>
                </div>

                {/* ─── Main Dashboard ─── */}
                <div className="flex-1 flex flex-col lg:flex-row gap-4 md:gap-6 p-4 md:p-6 lg:p-10 max-w-[1800px] mx-auto w-full relative mt-4 lg:mt-0" style={{ minHeight: 0 }}>

                    {/* ─── MOBILE: stack both videos vertically ─── */}
                    <div className="lg:hidden flex flex-col gap-4 px-4 py-4">
                        {/* Video A */}
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                            className="rounded-2xl overflow-hidden bg-black aspect-video relative border border-white/10 shadow-xl shrink-0 group">
                            {url1 && !isDesktop && <ReactPlayer ref={playerARef} url={url1} width="100%" height="100%" controls playing={isPlayingA} onPlay={() => setIsPlayingA(true)} onPause={() => setIsPlayingA(false)} config={{ youtube: { playerVars: { modestbranding: 1, rel: 0 } } }} />}
                            <div className="absolute top-3 left-3 bg-blue-600/90 backdrop-blur-md px-3 py-1 rounded-lg text-[8px] font-bold uppercase tracking-widest text-white border border-blue-400/30 shadow-lg">Video A</div>
                        </motion.div>
                        <div className="space-y-2">
                            <h1 className="font-bold text-base leading-snug text-white">{videoA?.title || "Stream A"}</h1>
                            <span className="inline-block text-[9px] font-bold uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full">{videoA?.channel || "Channel A"}</span>
                        </div>

                        {/* Video B */}
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                            className="rounded-2xl overflow-hidden bg-black aspect-video relative border border-white/10 shadow-xl shrink-0 group">
                            {url2 && !isDesktop && <ReactPlayer ref={playerBRef} url={url2} width="100%" height="100%" controls playing={isPlayingB} onPlay={() => setIsPlayingB(true)} onPause={() => setIsPlayingB(false)} config={{ youtube: { playerVars: { modestbranding: 1, rel: 0 } } }} />}
                            <div className="absolute top-3 left-3 bg-purple-600/90 backdrop-blur-md px-3 py-1 rounded-lg text-[8px] font-bold uppercase tracking-widest text-white border border-purple-400/30 shadow-lg">Video B</div>
                        </motion.div>
                        <div className="space-y-2">
                            <h1 className="font-bold text-base leading-snug text-white">{videoB?.title || "Stream B"}</h1>
                            <span className="inline-block text-[9px] font-bold uppercase tracking-widest text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded-full">{videoB?.channel || "Channel B"}</span>
                        </div>

                        {/* Tab Switcher - Sticky */}
                        <div className="sticky top-[58px] z-[120] -mx-4 px-4 py-3 bg-[#050505]/90 backdrop-blur-xl">
                            <div className="flex gap-2 bg-white/[0.04] border border-white/10 p-1 rounded-2xl">
                                <button onClick={() => setActiveTab("summary")}
                                    className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                                        activeTab === "summary" ? "bg-blue-600 border border-blue-500/40 text-white shadow-[0_0_20px_rgba(37,99,235,0.2)]" : "text-gray-400 hover:text-white")}>
                                    <Sparkles className={cn("w-3.5 h-3.5", activeTab === "summary" ? "text-blue-100" : "text-gray-500")} /> Contrast Map
                                </button>
                                <button onClick={() => setActiveTab("chat")}
                                    className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                                        activeTab === "chat" ? "bg-blue-600 border border-blue-500/40 text-white shadow-[0_0_20px_rgba(37,99,235,0.2)]" : "text-gray-400 hover:text-white")}>
                                    <MessageSquare className={cn("w-3.5 h-3.5", activeTab === "chat" ? "text-blue-100" : "text-gray-500")} /> Dual Chat
                                </button>
                            </div>
                        </div>

                        {/* Tab Content */}
                        {activeTab === "summary" ? (
                            <div data-lenis-prevent className="bg-[#0f1115] rounded-2xl border border-white/5 p-4 h-[calc(100dvh-300px)] min-h-[460px] overflow-y-auto overscroll-y-contain custom-scrollbar"
                                style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}>
                                {renderSummaryContent()}
                            </div>
                        ) : (
                            <div className="bg-[#070707] rounded-3xl border border-white/5 flex flex-col overflow-hidden relative"
                                style={{ height: 'calc(100dvh - 248px)', minHeight: '540px', touchAction: "pan-y" }}>
                                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/[0.05] blur-[50px] pointer-events-none" />
                                <div ref={mobileChatScrollRef} data-lenis-prevent
                                    className="flex-1 min-h-0 overflow-y-scroll overscroll-y-contain p-4 md:p-6 space-y-6 custom-scrollbar flex flex-col"
                                    style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
                                    {chatMessages.length === 0 ? renderChatEmpty() : (
                                        <div className="space-y-8 pb-6">
                                            {chatMessages.map(renderChatMessage)}
                                            <div ref={mobileChatEndRef} />
                                        </div>
                                    )}
                                </div>
                                {renderChatInput()}
                            </div>
                        )}
                    </div>

                    {/* ─── DESKTOP: side-by-side columns (lg+) ─── */}
                    <div className="hidden lg:contents">
                        {/* Left Column (Videos/Meta) */}
                        <div className="lg:w-[32%] xl:w-[26%] flex flex-col overflow-y-auto overflow-x-hidden scrollbar-hide pb-6 shrink-0 lg:pr-2 overscroll-contain lg:sticky lg:top-[68px] lg:h-[calc(100dvh-100px)]">
                            {/* Video A */}
                            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
                                className="rounded-[1.25rem] overflow-hidden bg-black aspect-video relative border border-white/10 shadow-[0_48px_80px_-20px_rgba(0,0,0,0.8)] mb-4 shrink-0 group">
                                {url1 && isDesktop && <ReactPlayer ref={playerARef} url={url1} width="100%" height="100%" controls playing={isPlayingA} onPlay={() => setIsPlayingA(true)} onPause={() => setIsPlayingA(false)} config={{ youtube: { playerVars: { modestbranding: 1, rel: 0 } } }} />}
                                <div className="absolute top-3 left-3 px-2.5 py-1 bg-blue-600/90 backdrop-blur-md rounded-lg text-[8px] font-bold uppercase tracking-widest text-white shadow-lg border border-blue-400/30">Video A</div>
                            </motion.div>
                            {/* Meta A */}
                            <div className="space-y-2 shrink-0 pb-4">
                                <h1 className="text-sm font-bold font-display tracking-tight leading-snug text-white line-clamp-2">{videoA?.title || "Stream A"}</h1>
                                <span className="inline-block px-2.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[9px] font-bold uppercase tracking-widest">{videoA?.channel || "Channel A"}</span>
                            </div>

                            {/* Video B */}
                            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                                className="rounded-[1.25rem] overflow-hidden bg-black aspect-video relative border border-white/10 shadow-[0_48px_80px_-20px_rgba(0,0,0,0.8)] mb-4 shrink-0 group">
                                {url2 && isDesktop && <ReactPlayer ref={playerBRef} url={url2} width="100%" height="100%" controls playing={isPlayingB} onPlay={() => setIsPlayingB(true)} onPause={() => setIsPlayingB(false)} config={{ youtube: { playerVars: { modestbranding: 1, rel: 0 } } }} />}
                                <div className="absolute top-3 left-3 px-2.5 py-1 bg-purple-600/90 backdrop-blur-md rounded-lg text-[8px] font-bold uppercase tracking-widest text-white shadow-lg border border-purple-400/30">Video B</div>
                            </motion.div>
                            {/* Meta B */}
                            <div className="space-y-2 shrink-0 pb-4">
                                <h1 className="text-sm font-bold font-display tracking-tight leading-snug text-white line-clamp-2">{videoB?.title || "Stream B"}</h1>
                                <span className="inline-block px-2.5 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[9px] font-bold uppercase tracking-widest">{videoB?.channel || "Channel B"}</span>
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-2 gap-3 shrink-0 mt-2">
                                {[
                                    { label: "Mode", value: "Dual-Core", icon: Zap },
                                    { label: "Sync Map", value: "Verified", icon: Scale },
                                ].map((stat, i) => (
                                    <div key={i} className="p-3 bg-white/[0.03] border border-white/5 rounded-2xl hover:bg-white/[0.05] transition-all group">
                                        <div className="flex items-center gap-1.5 mb-1 text-blue-500/50 group-hover:text-blue-400 transition-colors">
                                            <stat.icon className="w-3 h-3" />
                                            <span className="text-[8px] text-gray-500 font-bold uppercase tracking-widest">{stat.label}</span>
                                        </div>
                                        <div className="text-sm font-bold font-mono text-gray-200">{stat.value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ─── Right Column: Summary / Chat Hub ─── */}
                        <div className="flex-1 flex flex-col bg-[#070707] rounded-[2rem] border border-white/5 shadow-[0_40px_100px_rgba(0,0,0,0.6)] relative min-h-0 overflow-hidden">
                            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-600/[0.02] blur-[180px] pointer-events-none" />

                            {/* Tab Dock */}
                            <div className="shrink-0 flex gap-2 p-2 md:p-3 bg-white/[0.03] backdrop-blur-2xl overflow-x-auto hide-scrollbar">
                                <button onClick={() => setActiveTab("summary")}
                                    className={cn("flex items-center gap-2.5 px-5 md:px-7 py-3 md:py-3.5 rounded-xl md:rounded-2xl text-[10px] md:text-[11px] font-bold uppercase tracking-widest transition-all whitespace-nowrap relative group",
                                        activeTab === "summary" ? "text-white" : "text-gray-500 hover:text-white")}>
                                    <Sparkles className={cn("w-3.5 md:w-4 h-3.5 md:h-4", activeTab === "summary" ? "text-blue-400" : "text-gray-600")} />
                                    Contrast Map
                                    {activeTab === "summary" && <motion.div layoutId="activeCompareTab" initial={false} className="absolute inset-0 bg-blue-500/10 border border-blue-500/30 rounded-xl md:rounded-2xl -z-10 shadow-[0_0_25px_rgba(59,130,246,0.15)]" />}
                                </button>
                                <button onClick={() => setActiveTab("chat")}
                                    className={cn("flex items-center gap-2.5 px-5 md:px-7 py-3 md:py-3.5 rounded-xl md:rounded-2xl text-[10px] md:text-[11px] font-bold uppercase tracking-widest transition-all whitespace-nowrap relative group",
                                        activeTab === "chat" ? "text-white" : "text-gray-500 hover:text-white")}>
                                    <MessageSquare className={cn("w-3.5 md:w-4 h-3.5 md:h-4", activeTab === "chat" ? "text-blue-400" : "text-gray-600")} />
                                    Dual Chat
                                    {activeTab === "chat" && <motion.div layoutId="activeCompareTab" initial={false} className="absolute inset-0 bg-blue-500/10 border border-blue-500/30 rounded-xl md:rounded-2xl -z-10 shadow-[0_0_25px_rgba(59,130,246,0.15)]" />}
                                </button>
                            </div>

                            {/* Tab Content */}
                            <div className="flex-1 relative min-h-0 flex flex-col">
                                <AnimatePresence mode="wait">
                                    {activeTab === "summary" ? (
                                        <motion.div key="summary" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                                            data-lenis-prevent className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar overscroll-contain"
                                            style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}>
                                            <div className="p-5 md:p-8 lg:p-14 w-full">
                                                <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/5">
                                                    <div className="flex flex-col gap-1.5">
                                                        <h3 className="text-lg md:text-2xl font-serif italic text-blue-400 font-bold tracking-tight">Dual-Video Contrast Report</h3>
                                                        <div className="text-[8px] md:text-[9px] text-gray-500 font-mono font-bold uppercase tracking-[0.4em] flex items-center gap-2">
                                                            <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" /> Cross-Stream Link Established <Check className="w-2.5 h-2.5 text-green-500" />
                                                        </div>
                                                    </div>
                                                    <Tooltip text="Copy Summary" align="right">
                                                        <button onClick={handleCopy} className="p-3 bg-white/[0.03] hover:bg-white/[0.08] rounded-xl transition-all border border-white/10 text-gray-400 hover:text-white shadow-xl hover:scale-105 active:scale-95">
                                                            <Copy className="w-4 h-4" />
                                                        </button>
                                                    </Tooltip>
                                                </div>
                                                <div className="prose prose-invert max-w-none font-sans pb-20">
                                                    <ReactMarkdown components={{
                                                        h1: ({ children }) => <h1 className="text-white font-bold text-xl md:text-2xl mt-8 mb-3 font-serif">{children}</h1>,
                                                        h2: ({ children }) => <h2 className="text-white font-bold text-lg md:text-xl mt-6 mb-3 font-serif">{children}</h2>,
                                                        h3: ({ children }) => <h3 className="text-blue-300 font-bold text-base md:text-lg mt-5 mb-2 font-serif italic">{children}</h3>,
                                                        p: ({ children }) => <p className="mb-4 text-gray-300 text-[14px] md:text-[15px] leading-[1.8]">{children}</p>,
                                                        strong: ({ children }) => <strong className="text-white font-bold">{children}</strong>,
                                                        ul: ({ children }) => <ul className="mb-4 list-none p-0 space-y-1.5">{children}</ul>,
                                                        li: ({ children }) => (
                                                            <li className="flex gap-3.5 items-start mb-2 last:mb-0 group/li">
                                                                <Sparkles className="w-3 md:w-3.5 h-3 md:h-3.5 text-blue-500/40 shrink-0 mt-1.5 transition-all group-hover/li:text-blue-400" />
                                                                <span className="text-[13px] md:text-[14px] leading-relaxed text-gray-300 transition-colors group-hover/li:text-white">{children}</span>
                                                            </li>
                                                        ),
                                                        a: ({ href, children }) => renderMarkdownTimestamp(href, children),
                                                    }}>{parsedSummary.cleanMarkdown}</ReactMarkdown>
                                                </div>
                                                <p className="mt-1 text-[11px] text-gray-500 leading-relaxed">{ACCURACY_NOTE}</p>
                                            </div>
                                        </motion.div>
                                    ) : (
                                        <motion.div key="chat" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                                            className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ touchAction: "pan-y" }}>
                                            <div ref={desktopChatScrollRef} data-lenis-prevent
                                                className="flex-1 overflow-y-scroll overflow-x-hidden overscroll-y-contain custom-scrollbar p-5 md:p-6 lg:p-12 space-y-10 md:space-y-12 flex flex-col"
                                                style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
                                                {chatMessages.length === 0 ? (
                                                    renderChatEmpty()
                                                ) : (
                                                    <div className="space-y-10 pb-20">
                                                        {chatMessages.map(renderChatMessage)}
                                                    </div>
                                                )}
                                                <div ref={desktopChatEndRef} className="h-4 md:h-8 shrink-0" />
                                            </div>

                                            {/* Chat Input Area */}
                                            {renderChatInput()}
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
