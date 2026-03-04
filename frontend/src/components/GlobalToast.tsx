import { AlertCircle, Check, Info, TriangleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useMemo } from "react";
import { toast } from "sonner";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastContextValue {
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function ToastIcon({ type }: { type: ToastType }) {
  const styles: Record<Exclude<ToastType, "error">, string> = {
    success: "bg-emerald-500/20 text-emerald-400 border-emerald-400/30",
    info: "bg-sky-500/20 text-sky-400 border-sky-400/30",
    warning: "bg-amber-500/20 text-amber-400 border-amber-400/30",
  };

  if (type === "error") {
    return <AlertCircle className="w-7 h-7 text-red-400 shrink-0" />;
  }

  const icon = {
    success: <Check className="w-4 h-4" />,
    info: <Info className="w-4 h-4" />,
    warning: <TriangleAlert className="w-4 h-4" />,
  }[type as Exclude<ToastType, "error">];

  return (
    <span className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${styles[type as Exclude<ToastType, "error">]}`}>
      {icon}
    </span>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const showToast = useCallback((message: string, type: ToastType) => {
    const normalizedMessage = message.replace(/\s+/g, " ").trim();
    toast.custom(
      () => (
        <div className="inline-flex w-fit max-w-[min(30rem,calc(100vw-1rem))] items-center justify-center gap-2.5 px-3 py-2.5">
          <ToastIcon type={type} />
          <span className="max-w-[calc(100vw-5rem)] min-w-0 break-words whitespace-normal text-sm font-semibold leading-snug tracking-tight text-white">
            {normalizedMessage}
          </span>
        </div>
      ),
      { duration: 3000 },
    );
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
