import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-center"
      richColors={false}
      closeButton={false}
      toastOptions={{
        style: {
          width: "auto",
          minWidth: "0",
          maxWidth: "min(30rem, calc(100vw - 1rem))",
          marginLeft: "auto",
          marginRight: "auto",
        },
        classNames: {
          toast:
            "bg-[#0b0f17] border border-white/10 text-white shadow-2xl rounded-2xl !w-fit !min-w-0 !max-w-[min(30rem,calc(100vw-1rem))] !p-0 !mx-auto",
          title: "text-sm font-semibold tracking-tight",
          description: "text-xs text-gray-300",
        },
      }}
      {...props}
    />
  );
}
