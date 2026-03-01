import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { PlaySquare, FileText, ArrowRight, Zap, Brain, Clock, BarChart2, ArrowLeftRight, Github, Link2, Search, CheckCircle2, ChevronRight, Play, Sparkles, MessageCircleQuestion, ChevronDown, Rocket, Shield, Globe, ExternalLink, Mail, Twitter, Disc as Discord, Youtube, Linkedin, Instagram, Cpu, Database, Layers, LayoutGrid, Loader2 } from "lucide-react";
import { motion, AnimatePresence, useSpring, useTransform } from "framer-motion";
import { cn } from "../lib/utils";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 }
};

const stagger = {
  animate: {
    transition: {
      staggerChildren: 0.1
    }
  }
};

function NavLink({ href, label, activeSection }: { href: string, label: string, activeSection: string }) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const targetId = href.replace('#', '');
    const element = document.getElementById(targetId);
    if (element) {
      window.scrollTo({
        top: element.offsetTop - 120,
        behavior: 'smooth'
      });
    }
  };

  const isActive = activeSection === href.replace('#', '');

  return (
    <a
      href={href}
      onClick={handleClick}
      className={cn(
        "relative px-4 py-2 text-sm font-medium transition-colors duration-300",
        isActive ? "text-white" : "text-gray-400 hover:text-white"
      )}
    >
      {isActive && (
        <motion.div
          layoutId="nav-pill"
          className="absolute inset-0 bg-white/5 rounded-full z-[-1]"
          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
        />
      )}
      {label}
    </a>
  );
}

function AnimatedTerminal() {
  const [step, setStep] = useState(0);
  const steps = [
    { text: "Initializing RAG pipeline...", color: "text-blue-400" },
    { text: "Fetching transcript for v=dQw4w9WgXcQ", color: "text-gray-300" },
    { text: "Cleaning garbled captions...", done: true },
    { text: "Generating embeddings...", done: true },
    { text: "Extracting key insights...", color: "text-blue-400" },
    { text: "Analysis complete. 14 targets mapped.", color: "text-green-400", final: true },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % (steps.length + 2));
    }, 1500);
    return () => clearInterval(timer);
  }, [steps.length]);

  return (
    <div className="bg-[#050505] border border-white/10 rounded-3xl p-8 relative shadow-2xl min-h-[300px] flex flex-col justify-center">
      <div className="flex items-center gap-3 mb-8 border-b border-white/5 pb-4">
        <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
        <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
        <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
        <span className="text-[10px] text-gray-600 font-mono ml-2 uppercase tracking-widest">ClipIQ_Engine_v2.1</span>
      </div>
      <div className="space-y-4 font-mono text-sm leading-relaxed">
        {steps.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{
              opacity: step >= i ? 1 : 0,
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
    </div>
  );
}

function Tooltip({ children, text }: { children: React.ReactNode, text: string }) {
  return (
    <div className="group relative flex items-center justify-center">
      {children}
      <div className="absolute bottom-full mb-2 px-3 py-1 bg-white/10 backdrop-blur-md border border-white/10 rounded-lg text-[10px] text-white font-semibold opacity-0 group-hover:opacity-100 transition-all pointer-events-none whitespace-nowrap shadow-xl">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-white/10" />
      </div>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string, answer: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.3, ease: "easeOut" } }}
      className="bg-white/5 border border-white/5 rounded-2xl overflow-hidden mb-4"
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-6 text-left transition-colors"
      >
        <span className="text-lg font-semibold font-display flex items-center gap-3">
          <MessageCircleQuestion className="w-5 h-5 text-blue-400" />
          {question}
        </span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }}
          className="text-gray-500"
        >
          <ChevronDown className="w-5 h-5" />
        </motion.div>
      </button>
      <AnimatePresence mode="wait">
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6">
              <p className="text-gray-400 leading-relaxed pl-8">
                {answer}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function MetricBar({ label, a, b }: { label: string, a: number, b: number }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-[11px] font-bold text-gray-500 uppercase tracking-[0.1em]">
        <span>{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] text-blue-400 font-mono">
            <span>VIDEO A</span>
            <span>{a}%</span>
          </div>
          <div className="h-1.5 w-full bg-blue-500/10 rounded-full overflow-hidden relative">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${a}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full relative"
            >
              <div className="absolute inset-y-0 right-0 w-4 bg-blue-400 blur-md opacity-50" />
            </motion.div>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] text-purple-400 font-mono">
            <span>VIDEO B</span>
            <span>{b}%</span>
          </div>
          <div className="h-1.5 w-full bg-purple-500/10 rounded-full overflow-hidden relative">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${b}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full relative"
            >
              <div className="absolute inset-y-0 right-0 w-4 bg-purple-400 blur-md opacity-50" />
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { threshold: 0.5 }
    );

    const sections = ["features", "how-it-works", "faqs"];
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-blue-500/30 overflow-x-hidden relative">
      {/* Background Effects */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/10 blur-[120px]" />
      </div>

      {/* Navbar Upgrade */}
      <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-4xl px-4">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-[#0a0a0a]/70 backdrop-blur-2xl border border-white/10 rounded-full px-6 h-14 flex items-center justify-between shadow-[0_20px_40px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-center gap-2 group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center shadow-lg group-hover:rotate-12 transition-transform">
              <PlaySquare className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight font-display hidden sm:block">ClipIQ</span>
          </div>

          <div className="flex items-center gap-1">
            {[
              { href: "#features", label: "Features" },
              { href: "#how-it-works", label: "How It Works" },
              { href: "#faqs", label: "FAQs" }
            ].map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} activeSection={activeSection} />
            ))}
          </div>

          <div className="flex items-center gap-3">
            <a href="https://github.com/XynaxDev" target="_blank" rel="noreferrer" className="text-gray-400 hover:text-white transition-all hover:scale-110">
              <Github className="w-5 h-5" />
            </a>
            <Link to="/dashboard" className="bg-white text-black hover:bg-gray-100 text-[11px] font-bold uppercase tracking-widest px-5 py-2 rounded-full transition-all hover:shadow-[0_0_20px_rgba(255,255,255,0.2)]">
              Launch App
            </Link>
          </div>
        </motion.div>
      </nav>

      <main className="pt-32 pb-24 relative z-10">
        {/* Hero */}
        <motion.section
          initial="initial"
          animate="animate"
          variants={stagger}
          className="max-w-5xl mx-auto px-6 text-center mb-32 pt-10"
        >
          <motion.div variants={fadeIn} className="inline-flex flex-wrap items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-2xl sm:rounded-full bg-white/5 border border-white/10 text-gray-300 text-[10px] sm:text-xs font-medium mb-8 backdrop-blur-sm mx-auto">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-white/80 whitespace-nowrap">Introducing ClipIQ 2.0</span>
            </div>
            <span className="hidden sm:block w-1 h-1 rounded-full bg-gray-600 mx-1"></span>
            <span className="text-blue-400 flex items-center gap-1 whitespace-nowrap">
              Video Reasoning Engine <ChevronRight className="w-3 h-3" />
            </span>
          </motion.div>
          <motion.h1 variants={fadeIn} className="text-5xl md:text-6xl font-bold tracking-tight mb-8 leading-[1.05] font-display">
            Video intelligence <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 font-serif font-bold italic">at the speed of thought</span>
          </motion.h1>
          <motion.p variants={fadeIn} className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Stop watching hours of filler. ClipIQ uses advanced RAG to extract precise insights, compare tutorials, and pinpoint exact timestamps in seconds.
          </motion.p>
          <motion.div variants={fadeIn} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/dashboard" className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-4 rounded-full flex items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(37,99,235,0.3)]">
              Start Analyzing Free
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#how-it-works" className="w-full sm:w-auto bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-8 py-4 rounded-full transition-all flex items-center justify-center gap-2">
              <Play className="w-4 h-4" />
              See How It Works
            </a>
          </motion.div>

          {/* Dashboard Preview Section */}
          <div className="mt-32 relative">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-5xl md:text-6xl font-bold mb-4 font-serif italic tracking-tight">Master your library</h2>
              <p className="text-gray-400 max-w-xl mx-auto text-sm font-medium uppercase tracking-[0.3em] opacity-60 font-sans">A command center designed for knowledge extraction.</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative rounded-[2rem] overflow-hidden border border-white/10 shadow-[0_0_50px_rgba(37,99,235,0.15)] bg-[#0a0a0a]"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent z-10 pointer-events-none"></div>
              <img src="https://picsum.photos/seed/clipiq-ui/1400/800?grayscale" alt="ClipIQ Dashboard" className="w-full h-auto object-cover opacity-60 transition-transform duration-700 hover:scale-105" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-16 grid grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto"
            >
              {[
                { stat: "1M+", label: "Videos Indexed", color: "from-blue-500/20 to-blue-500/5", textColor: "text-blue-400" },
                { stat: "99%", label: "Timestamp Accuracy", color: "from-purple-500/20 to-purple-500/5", textColor: "text-purple-400" },
                { stat: "12s", label: "Avg. Processing Time", color: "from-pink-500/20 to-pink-500/5", textColor: "text-pink-400" },
                { stat: "4.9/5", label: "User Rating", color: "from-amber-500/20 to-amber-500/5", textColor: "text-amber-400" },
              ].map((s, i) => (
                <div key={i} className={cn("relative p-8 rounded-3xl bg-gradient-to-br border border-white/5 backdrop-blur-sm", s.color)}>
                  <div className={cn("text-4xl font-bold mb-2 font-display", s.textColor)}>{s.stat}</div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">{s.label}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </motion.section>

        {/* Marquee Section with Fade */}
        <section className="py-24 relative">
          <div className="max-w-7xl mx-auto px-6 mb-12 text-center">
            <p className="text-[10px] font-bold text-blue-500/60 uppercase tracking-[0.4em] mb-2">The Stack</p>
            <h3 className="text-3xl font-serif italic text-white/80">Built with standard tech</h3>
          </div>

          <div className="relative overflow-hidden w-full [mask-image:linear-gradient(to_right,transparent,black_20%,black_80%,transparent)]">
            <div className="flex gap-20 animate-marquee whitespace-nowrap py-4">
              {[
                { name: "LangChain", icon: Layers },
                { name: "FastAPI", icon: Zap },
                { name: "OpenRouter", icon: Cpu },
                { name: "ChromaDB", icon: Database },
                { name: "BGE-M3 Models", icon: Brain },
                { name: "React 19", icon: Globe },
                { name: "TailwindCSS", icon: LayoutGrid },
                { name: "Framer", icon: Sparkles },
                { name: "Python RAG", icon: Rocket }
              ].map((tech, i) => (
                <div key={i} className="flex items-center gap-6 group cursor-default">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center group-hover:bg-blue-500/10 group-hover:border-blue-500/20 transition-all duration-500">
                    <tech.icon className="w-6 h-6 text-white/20 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-500" />
                  </div>
                  <span className="text-3xl font-serif italic text-white/5 group-hover:text-white transition-all duration-700">{tech.name}</span>
                </div>
              ))}
              {/* Duplicate loop */}
              {[
                { name: "LangChain", icon: Layers },
                { name: "FastAPI", icon: Zap },
                { name: "OpenRouter", icon: Cpu },
                { name: "ChromaDB", icon: Database },
                { name: "BGE-M3 Models", icon: Brain },
                { name: "React 19", icon: Globe },
                { name: "TailwindCSS", icon: LayoutGrid },
                { name: "Framer", icon: Sparkles },
                { name: "Python RAG", icon: Rocket }
              ].map((tech, i) => (
                <div key={i + "-dup"} className="flex items-center gap-6 group cursor-default">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center group-hover:bg-blue-500/10 group-hover:border-blue-500/20 transition-all duration-500">
                    <tech.icon className="w-6 h-6 text-white/20 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-500" />
                  </div>
                  <span className="text-3xl font-serif italic text-white/5 group-hover:text-white transition-all duration-700">{tech.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features improved */}
        <section id="features" className="max-w-7xl mx-auto px-6 mb-32 pt-20">
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeIn}
            className="text-center mb-20"
          >
            <h2 className="text-5xl md:text-6xl font-bold mb-6 font-display">Deep reasoning, <br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 font-serif font-bold italic">zero filler.</span></h2>
            <p className="text-gray-400 max-w-2xl mx-auto text-lg leading-relaxed font-sans">We don't just summarize text; we map concepts across time and space in your video library.</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Brain, title: "Single-Video RAG", desc: "Maps every concept to precise timestamps. Ask specifics, get direct video jump-points.", color: "blue" },
              { icon: ArrowLeftRight, title: "Video Intelligence", desc: "Cross-reference two tutorials instantly. Grade time-efficiency vs information-depth automatically.", color: "purple" },
              { icon: Shield, title: "Messy Transcript Resilence", desc: "Cleans garbled auto-captions and handles multi-language transcripts without crashing.", color: "pink" },
              { icon: BarChart2, title: "Authoritative Context", desc: "Deep YouTube API integration ensures the AI knows the channel status and video authority.", color: "amber" },
              { icon: Clock, title: "Temporal Accuracy", desc: "Clickable source links that take you exactly to the moment a concept is explained.", color: "indigo" },
              { icon: Rocket, title: "Fast Inference", desc: "Parallel processing allows us to ingest and index hour-long videos in under 15 seconds.", color: "green" },
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ scale: 1.02 }}
                className={cn(
                  "bg-gradient-to-b from-white/10 to-transparent border border-white/5 rounded-[2.5rem] p-10 transition-all group relative overflow-hidden backdrop-blur-md hover:border-white/20 shadow-2xl hover:shadow-white/5",
                  feature.color === "blue" ? "hover:shadow-blue-500/10" : "",
                  feature.color === "purple" ? "hover:shadow-purple-500/10" : "",
                  feature.color === "pink" ? "hover:shadow-pink-500/10" : "",
                  feature.color === "amber" ? "hover:shadow-amber-500/10" : "",
                  feature.color === "indigo" ? "hover:shadow-indigo-500/10" : "",
                  feature.color === "green" ? "hover:shadow-green-500/10" : "",
                )}
              >
                <div className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center mb-8 shadow-xl transition-transform group-hover:scale-110 group-hover:rotate-3",
                  feature.color === "blue" ? "bg-blue-500/20 text-blue-400" : "",
                  feature.color === "purple" ? "bg-purple-500/20 text-purple-400" : "",
                  feature.color === "pink" ? "bg-pink-500/20 text-pink-400" : "",
                  feature.color === "amber" ? "bg-amber-500/20 text-amber-400" : "",
                  feature.color === "indigo" ? "bg-indigo-500/20 text-indigo-400" : "",
                  feature.color === "green" ? "bg-green-500/20 text-green-400" : "",
                )}>
                  <feature.icon className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-bold mb-4 font-display text-white">{feature.title}</h3>
                <p className="text-gray-400 leading-relaxed text-[15px]">{feature.desc}</p>
                <div className="mt-8 flex items-center gap-2 text-blue-400 font-semibold group-hover:gap-4 transition-all opacity-0 group-hover:opacity-100">
                  Read More <ArrowRight className="w-4 h-4" />
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* How it Works */}
        <section id="how-it-works" className="max-w-7xl mx-auto px-6 mb-32 pt-20">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="bg-gradient-to-b from-[#0a0a0a] to-[#050505] border border-white/5 rounded-3xl md:rounded-[3rem] p-6 sm:p-10 md:p-20 relative overflow-hidden shadow-2xl"
          >
            <div className="absolute top-0 right-0 w-1/2 h-full bg-blue-500/5 blur-[150px] pointer-events-none"></div>

            <div className="grid lg:grid-cols-2 gap-16 items-center relative z-10">
              <div>
                <h2 className="text-5xl md:text-6xl font-bold mb-6 font-display">From URL to insight in <br /><span className="text-blue-400 font-serif font-bold italic">three steps</span></h2>
                <p className="text-gray-400 text-lg mb-10 font-sans">Our pipeline handles transcript extraction, cleaning, embedding, and reasoning in seconds.</p>

                <div className="space-y-8">
                  {[
                    { icon: Link2, title: "Provide Context", desc: "Paste one or more YouTube URLs. We fetch the metadata, transcripts, and channel authority." },
                    { icon: Search, title: "AI Processing", desc: "Our RAG pipeline cleans the transcript and chunks it for semantic search and reasoning." },
                    { icon: CheckCircle2, title: "Actionable Output", desc: "Get timestamped summaries, comparisons, and direct answers to your specific questions." },
                  ].map((step, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.15 + 0.3 }}
                      className="flex gap-6 group cursor-default"
                    >
                      <div className="shrink-0 mt-1">
                        <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 group-hover:scale-110 group-hover:bg-blue-500/20 transition-all">
                          <step.icon className="w-5 h-5" />
                        </div>
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold mb-2 font-display">{step.title}</h3>
                        <p className="text-gray-400 leading-relaxed">{step.desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="relative"
              >
                <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-purple-500/20 rounded-3xl blur-2xl"></div>
                <AnimatedTerminal />
              </motion.div>
            </div>
          </motion.div>
        </section>

        {/* Why ClipIQ */}
        <section className="max-w-7xl mx-auto px-6 mb-32">
          <div className="grid lg:grid-cols-2 gap-20 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-6"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-bold rounded-full uppercase tracking-widest">
                Why it matters
              </div>
              <h2 className="text-5xl md:text-6xl font-bold font-display leading-[1.1]">The world's first <br /> <span className="text-blue-400 font-serif font-bold italic">temporal search</span></h2>
              <p className="text-gray-400 text-lg leading-relaxed mb-8">
                Most AI tools give you a text summary of a video. We give you a direct brain-to-video connection.
                Our BGE-M3 embedding models are tuned to understand the intersection of spoken text and visual time.
              </p>
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                  <Globe className="w-6 h-6 text-blue-400 mb-4" />
                  <h4 className="font-bold mb-2">Multi-lingual</h4>
                  <p className="text-sm text-gray-500">Search tutorials in 95+ languages with zero loss in retrieval precision.</p>
                </div>
                <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                  <Shield className="w-6 h-6 text-purple-400 mb-4" />
                  <h4 className="font-bold mb-2">Privacy First</h4>
                  <p className="text-sm text-gray-500">Your analysis is stored locally in your browser. We don't track your history.</p>
                </div>
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="relative"
            >
              <div className="absolute inset-0 bg-blue-500/20 blur-[100px] pointer-events-none rounded-full"></div>
              <div className="bg-gradient-to-br from-white/10 to-white/5 border border-white/10 rounded-[3rem] p-8 backdrop-blur-3xl shadow-3xl">
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <div className="font-bold">Comparative Grading</div>
                    <div className="text-blue-400 text-xs font-mono">CLIPIQ_ENGINE: 2.1</div>
                  </div>
                  {[
                    { label: "Information Depth", a: 95, b: 72 },
                    { label: "Instructional Clarity", a: 88, b: 94 },
                    { label: "Pace & Efficiency", a: 91, b: 65 },
                  ].map((metric, i) => (
                    <MetricBar key={i} {...metric} />
                  ))}
                  <div className="pt-4 text-xs text-gray-500 leading-relaxed italic border-t border-white/5">
                    "ClipIQ Result: Video A is superior for advanced implementations, while Video B is recommended for absolute beginners."
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* FAQs dropdown */}
        <section id="faqs" className="max-w-4xl mx-auto px-6 mb-32">
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeIn}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-6 font-display">Frequently Asked Questions</h2>
            <p className="text-gray-400">Everything you need to know about ClipIQ</p>
          </motion.div>

          <div className="space-y-4">
            {[
              { q: "Does this work on videos without captions?", a: "ClipIQ requires videos to have at least auto-generated captions to extract the transcript. If a video has no closed captions track, the pipeline cannot process the text." },
              { q: "How accurate are the timestamps?", a: "We use a Self-Query Retriever with timestamp metadata alongside semantic search. This guarantees that when the AI generates a source link, it exactly maps back to the document chunk from that second." },
              { q: "What embedding model doesn't crash on bad captions?", a: "We wrap our BGE-M3 models in a SafeOllamaEmbeddings wrapper. This prevents NaN or Inf vectors when given messy auto-captions with missing characters." },
              { q: "Can I compare a one-hour lecture with a ten-minute summary?", a: "Yes. The Comparison pipeline handles disparate lengths easily and specifically grades time-efficiency vs information-depth." },
              { q: "Is my data used for model training?", a: "Absolutely not. We use enterprise-grade APIs with zero data-retention policies. Your private video processing remains private." },
              { q: "Does it support playlist analysis?", a: "Currently, we focus on deep-dives for single and dual-video contexts. Multi-video playlist summarization is coming in the next update!" }
            ].map((faq, i) => (
              <FAQItem key={i} question={faq.q} answer={faq.a} />
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-4xl mx-auto px-6 text-center mb-20">
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={fadeIn}
          >
            <h2 className="text-5xl md:text-6xl font-bold mb-8 font-serif italic tracking-tight italic">Ready to upgrade your learning?</h2>
            <Link to="/dashboard" className="inline-flex items-center justify-center gap-2 bg-white text-black hover:bg-gray-100 font-semibold px-10 py-5 rounded-full text-lg transition-all hover:scale-105 active:scale-95 shadow-[0_0_40px_rgba(255,255,255,0.2)]">
              Launch ClipIQ Now
              <ArrowRight className="w-5 h-5" />
            </Link>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-white/5 pt-24 pb-12 bg-[#050505] relative z-10 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-12 mb-20">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                <PlaySquare className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl font-display tracking-tight">ClipIQ</span>
            </div>
            <p className="text-gray-500 text-sm leading-relaxed mb-8 max-w-[200px]">
              The next generation of video intelligence for researchers, students, and engineers.
            </p>
            <div className="flex gap-4">
              <Tooltip text="X (Twitter)">
                <a href="https://x.com/akashksah" target="_blank" rel="noreferrer" className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-all border border-white/5">
                  <Twitter className="w-5 h-5" />
                </a>
              </Tooltip>
              <Tooltip text="GitHub">
                <a href="https://github.com/XynaxDev" target="_blank" rel="noreferrer" className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-all border border-white/5">
                  <Github className="w-5 h-5" />
                </a>
              </Tooltip>
              <Tooltip text="LinkedIn">
                <a href="https://linkedin.com/in/akashksah" target="_blank" rel="noreferrer" className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-all border border-white/5">
                  <Linkedin className="w-5 h-5" />
                </a>
              </Tooltip>
              <Tooltip text="Instagram">
                <a href="https://instagram.com/xynaxhere" target="_blank" rel="noreferrer" className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-all border border-white/5">
                  <Instagram className="w-5 h-5" />
                </a>
              </Tooltip>
              <Tooltip text="Email Me">
                <a href="mailto:akashkumar.cs27@gmail.com" className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-all border border-white/5">
                  <Mail className="w-5 h-5" />
                </a>
              </Tooltip>
            </div>
          </div>

          <div>
            <h4 className="font-bold mb-6 uppercase text-xs tracking-widest text-gray-400">Platform</h4>
            <ul className="space-y-4 text-sm text-gray-500">
              <li><Link to="/dashboard" className="hover:text-white transition-colors">Intelligence Hub</Link></li>
              <li><Link to="/summarize" className="hover:text-white transition-colors">Video Summaries</Link></li>
              <li><Link to="/compare" className="hover:text-white transition-colors">Comparison Engine</Link></li>
              <li><Link to="/history" className="hover:text-white transition-colors">Search History</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-6 uppercase text-xs tracking-widest text-gray-400">Resources</h4>
            <ul className="space-y-4 text-sm text-gray-500">
              <li className="hover:text-white cursor-pointer transition-colors">Documentation</li>
              <li className="hover:text-white cursor-pointer transition-colors">API Reference</li>
              <li className="hover:text-white cursor-pointer transition-colors">System Status</li>
              <li className="hover:text-white cursor-pointer transition-colors">Github Repo</li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-6 uppercase text-xs tracking-widest text-gray-400">Stay Updated</h4>
            <div className="relative group">
              <input
                type="email"
                placeholder="email@example.com"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50 transition-all"
              />
              <button className="absolute right-2 top-2 p-1.5 bg-blue-600 rounded-lg text-white">
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 border-t border-white/5 pt-12 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-xs text-gray-600 font-medium">
            © 2026 ClipIQ Intelligence Inc. All rights reserved.
          </div>
          <div className="flex gap-8 text-xs text-gray-600 font-medium">
            <span className="hover:text-white cursor-pointer">Privacy Policy</span>
            <span className="hover:text-white cursor-pointer">Terms of Service</span>
            <span className="hover:text-white cursor-pointer">Security</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
