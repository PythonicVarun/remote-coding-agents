import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { ExternalLink, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface FilePreviewModalProps {
  open: boolean;
  projectId: string;
  /** POSIX relative path inside the project. */
  path: string;
  /** Display name (defaults to the basename of path). */
  name?: string;
  onClose: () => void;
}

type Kind = "markdown" | "html" | "text" | "binary";

interface Loaded {
  content: string;
  truncated: boolean;
  size: number;
}

function kindOf(name: string): Kind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) {
    return "markdown";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml")) {
    return "html";
  }
  return "text";
}

/** Treat as binary when >1% of the first 4 KB is non-printable / non-whitespace. */
function looksBinary(s: string): boolean {
  const sample = s.slice(0, 4096);
  if (!sample) return false;
  let bad = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true;
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) bad += 1;
  }
  return bad / sample.length > 0.01;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wrap the rendered preview body in a self-contained HTML document. The same
 * doc is used for both the in-modal sandboxed iframe and the "open in new
 * window" popup, so they look identical.
 */
function buildPreviewDocument(args: {
  title: string;
  body: string;
  /** When true, body is rendered inside a typographic wrapper (markdown). */
  typographic: boolean;
  themeVars: Record<string, string>;
}): string {
  const { title, body, typographic, themeVars } = args;
  const vars = Object.entries(themeVars)
    .map(([k, v]) => `${k}: ${v};`)
    .join("");
  const wrap = typographic
    ? `<article class="prose">${body}</article>`
    : body;
  return `<!doctype html>
<html data-theme="${themeVars["--theme-name"] === "dark" ? "dark" : "light"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { ${vars} color-scheme: ${themeVars["--theme-name"] === "dark" ? "dark" : "light"}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
body {
  font-family: -apple-system, "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
  line-height: 1.6;
  padding: 24px;
}
.prose { max-width: 820px; margin: 0 auto; }
.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 {
  margin-top: 1.4em; margin-bottom: 0.5em; line-height: 1.25;
  font-weight: 600; letter-spacing: -0.01em;
}
.prose h1 { font-size: 1.8rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
.prose h2 { font-size: 1.4rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
.prose h3 { font-size: 1.15rem; }
.prose p, .prose ul, .prose ol, .prose blockquote, .prose pre, .prose table {
  margin: 0.75em 0;
}
.prose ul, .prose ol { padding-left: 1.5em; }
.prose blockquote {
  border-left: 3px solid var(--accent);
  padding: 0.1em 1em;
  color: var(--fg-muted);
  background: var(--bg-subtle);
  border-radius: 0 6px 6px 0;
}
.prose a { color: var(--accent); }
.prose code {
  background: var(--bg-muted);
  border-radius: 4px;
  padding: 0.15em 0.4em;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, Menlo, monospace;
  font-size: 0.92em;
}
.prose pre {
  background: var(--bg-muted);
  color: var(--fg);
  padding: 12px 14px;
  border-radius: 8px;
  overflow: auto;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, Menlo, monospace;
  font-size: 0.9em;
  line-height: 1.5;
}
.prose pre code { background: transparent; padding: 0; font-size: inherit; }
.prose img { max-width: 100%; height: auto; }
.prose table { border-collapse: collapse; }
.prose th, .prose td { border: 1px solid var(--border); padding: 6px 10px; }
.prose th { background: var(--bg-subtle); text-align: left; }
.prose hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
.prose .header-anchor { text-decoration: none; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background-color: ${themeVars["--scrollbar-thumb"] ?? "rgb(116 131 143 / 0.45)"};
  border-radius: 999px; border: 2px solid transparent; background-clip: padding-box;
}
</style>
</head>
<body>${wrap}</body>
</html>`;
}

function readThemeVars(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const wrap = (token: string) => `rgb(${v(token)})`;
  return {
    "--bg": wrap("--color-bg"),
    "--bg-subtle": wrap("--color-bg-subtle"),
    "--bg-muted": wrap("--color-bg-muted"),
    "--border": wrap("--color-border"),
    "--fg": wrap("--color-fg"),
    "--fg-muted": wrap("--color-fg-muted"),
    "--accent": wrap("--color-accent"),
    "--scrollbar-thumb": v("--scrollbar-thumb") || "rgb(116 131 143 / 0.45)",
    "--theme-name":
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  };
}

export function FilePreviewModal({
  open,
  projectId,
  path,
  name,
  onClose,
}: FilePreviewModalProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupUrlRef = useRef<string | null>(null);

  const displayName = name ?? path.split("/").pop() ?? path;
  const kind: Kind = useMemo(() => {
    if (!loaded) return kindOf(displayName);
    if (looksBinary(loaded.content)) return "binary";
    return kindOf(displayName);
  }, [loaded, displayName]);

  useEffect(() => {
    if (!open) {
      setLoaded(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .readFile(projectId, path)
      .then((r) => {
        if (!cancelled) setLoaded(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, path]);

  // Release any popup blob URL when the modal closes.
  useEffect(() => {
    if (!open && popupUrlRef.current) {
      URL.revokeObjectURL(popupUrlRef.current);
      popupUrlRef.current = null;
    }
  }, [open]);

  const documentSource = useMemo(() => {
    if (!loaded || kind === "binary") return null;
    const themeVars = readThemeVars();
    if (kind === "markdown") {
      const html = marked.parse(loaded.content, { async: false, gfm: true }) as string;
      return buildPreviewDocument({
        title: displayName,
        body: html,
        typographic: true,
        themeVars,
      });
    }
    if (kind === "html") {
      // Render the raw HTML inside our themed shell — but treat it as a
      // self-contained document; we still wrap to apply scrollbar tokens.
      return buildPreviewDocument({
        title: displayName,
        body: loaded.content,
        typographic: false,
        themeVars,
      });
    }
    // Plain text: render as a single <pre>.
    return buildPreviewDocument({
      title: displayName,
      body: `<pre>${escapeHtml(loaded.content)}</pre>`,
      typographic: true,
      themeVars,
    });
  }, [loaded, kind, displayName]);

  const openInNewWindow = () => {
    if (!documentSource) return;
    if (popupUrlRef.current) {
      URL.revokeObjectURL(popupUrlRef.current);
      popupUrlRef.current = null;
    }
    const blob = new Blob([documentSource], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    popupUrlRef.current = url;
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win || win.closed || typeof win.closed === 'undefined') {
      // Popup blocked — surface a hint.
      setError("Popup blocked. Allow popups for this site to open the preview in a new window.");
    } else {
      win.focus();
    }
  };

  const kindBadge =
    kind === "markdown"
      ? "Markdown"
      : kind === "html"
        ? "HTML"
        : kind === "binary"
          ? "Binary"
          : "Text";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={displayName}
      description={path}
      width="lg"
      footer={
        <>
          <Badge tone="neutral">{kindBadge}</Badge>
          {loaded ? (
            <span className="ml-1 text-[11px] text-fg-subtle">
              {loaded.size.toLocaleString()} B{loaded.truncated ? " · truncated" : ""}
            </span>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={openInNewWindow}
            disabled={!documentSource}
            title="Open the preview in a new browser window"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in new window
          </Button>
        </>
      }
    >
      <div className="h-[60vh] min-h-[320px]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">
            Loading…
          </div>
        ) : error ? (
          <div className="rounded border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
            {error}
          </div>
        ) : kind === "binary" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-fg-muted">
            <FileText className="h-6 w-6 text-fg-subtle" />
            <div>Binary file — preview not available.</div>
            {loaded ? (
              <div className="text-[11px] text-fg-subtle">
                {loaded.size.toLocaleString()} B
              </div>
            ) : null}
          </div>
        ) : documentSource ? (
          <iframe
            title={`Preview of ${displayName}`}
            srcDoc={documentSource}
            sandbox="allow-same-origin"
            className="h-full w-full rounded-md border border-border-subtle bg-bg"
          />
        ) : null}
      </div>
    </Dialog>
  );
}
