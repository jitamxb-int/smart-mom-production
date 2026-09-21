"use client";

import { useEffect, useRef, useState } from "react";
import { DiagramData } from "@/types";
import { RefreshCw, AlertTriangle, Loader2 } from "lucide-react";

interface MermaidRendererProps {
  diagram:       DiagramData | null;
  onRegenerate?: () => void;
}

export function MermaidRenderer({ diagram, onRegenerate }: MermaidRendererProps) {
  const ref         = useRef<HTMLDivElement>(null);
  const [renderErr, setRenderErr] = useState(false);

  useEffect(() => {
    if (!diagram || diagram.status !== "ready" || !diagram.mermaid_syntax || !ref.current) return;

    setRenderErr(false);

    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });

        if (cancelled || !ref.current) return;
        ref.current.innerHTML   = diagram.mermaid_syntax!;
        ref.current.removeAttribute("data-processed");
        await mermaid.run({ nodes: [ref.current] });
      } catch (e) {
        console.error("Mermaid render error:", e);
        if (!cancelled) setRenderErr(true);
      }
    })();

    return () => { cancelled = true; };
  }, [diagram?.mermaid_syntax, diagram?.status]);

  if (!diagram || diagram.status === "not_applicable") return null;

  if (diagram.status === "pending") {
    return (
      <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Generating diagram…</span>
      </div>
    );
  }

  if (diagram.status === "failed" || renderErr) {
    return (
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm text-amber-800 font-medium">Diagram generation failed</p>
          <p className="text-xs text-amber-600 mt-1">{diagram.error || "Could not render diagram"}</p>
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="mt-2 flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              <RefreshCw className="h-3 w-3" />
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 overflow-auto">
      {diagram.type && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full capitalize">
            {diagram.type}
          </span>
        </div>
      )}
      <div ref={ref} className="mermaid" />
    </div>
  );
}
