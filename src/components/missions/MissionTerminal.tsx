/**
 * MissionTerminal — xterm.js-backed terminal panel with collapse and resize.
 *
 * This component always runs client-side. Callers MUST load it via
 * next/dynamic with { ssr: false } to avoid SSR issues with xterm's DOM
 * dependency:
 *
 *   const MissionTerminal = dynamic(
 *     () => import("@/src/components/missions/MissionTerminal").then(m => m.MissionTerminal),
 *     { ssr: false }
 *   );
 */
"use client";

import * as React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LS_HEIGHT_KEY = "mission-terminal-height";
const LS_OPEN_KEY = "mission-terminal-open";
const MIN_HEIGHT = 80;
const CLAMP_FRACTION = 0.6;
const DEFAULT_HEIGHT = 280;

// ---------------------------------------------------------------------------
// Imperative handle
// ---------------------------------------------------------------------------

export interface MissionTerminalHandle {
  write: (text: string) => void;
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MissionTerminalProps {
  /** Label shown in the toolbar. Defaults to "Terminal". */
  title?: string;
  /** Whether the panel starts open. Persisted in localStorage. */
  defaultOpen?: boolean;
  /**
   * When this prop transitions to `true`, the panel opens regardless of the
   * persisted localStorage state. The parent can set it to `true` to
   * programmatically open the terminal (e.g. on "Run Mission" click) without
   * reaching into localStorage directly.
   */
  imperativeOpen?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function readStoredHeight(): number {
  try {
    const stored = localStorage.getItem(LS_HEIGHT_KEY);
    if (stored !== null) {
      const n = parseInt(stored, 10);
      if (!isNaN(n)) return n;
    }
  } catch {
    // localStorage unavailable (SSR guard — should not reach here)
  }
  return DEFAULT_HEIGHT;
}

function readStoredOpen(defaultOpen: boolean): boolean {
  try {
    const stored = localStorage.getItem(LS_OPEN_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // localStorage unavailable
  }
  return defaultOpen;
}

export const MissionTerminal = React.forwardRef<
  MissionTerminalHandle,
  MissionTerminalProps
>(function MissionTerminal(
  { title = "Terminal", defaultOpen = false, imperativeOpen },
  ref
) {
  // --- open/collapsed state ---
  const [isOpen, setIsOpen] = React.useState<boolean>(() =>
    readStoredOpen(defaultOpen)
  );

  // --- imperativeOpen: open the panel whenever the prop flips to true ---
  React.useEffect(() => {
    if (imperativeOpen) {
      setIsOpen(true);
    }
  }, [imperativeOpen]);

  // --- panel height ---
  const [height, setHeight] = React.useState<number>(() => readStoredHeight());

  // --- refs for xterm internals ---
  const containerRef = React.useRef<HTMLDivElement>(null);
  const terminalRef = React.useRef<Terminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);

  // --- pending writes queue ---
  // Writes that arrive before the xterm instance is initialized (e.g. because
  // the panel was just opened and the effect hasn't run yet) are buffered here
  // and flushed once the terminal is ready.
  const pendingWritesRef = React.useRef<string[]>([]);

  // --- persist open state ---
  React.useEffect(() => {
    try {
      localStorage.setItem(LS_OPEN_KEY, String(isOpen));
    } catch {
      // ignore
    }
  }, [isOpen]);

  // --- persist height ---
  React.useEffect(() => {
    try {
      localStorage.setItem(LS_HEIGHT_KEY, String(height));
    } catch {
      // ignore
    }
  }, [height]);

  // --- xterm setup + ResizeObserver ---
  React.useEffect(() => {
    if (!isOpen) return;
    if (!containerRef.current) return;

    // Read the CSS custom property at runtime so the terminal background
    // always matches the design-token value, including after theme switches.
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue("--terminal-bg")
      .trim();

    const terminal = new Terminal({
      theme: { background: bg || "#000000" },
      convertEol: true,
      scrollback: 5000,
      fontFamily:
        'var(--font-jetbrains-mono), "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Flush any writes that arrived before this effect ran.
    for (const text of pendingWritesRef.current) {
      terminal.write(text);
    }
    pendingWritesRef.current = [];

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // Re-initialise only when the panel is opened/closed, not on height changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Re-fit whenever height changes while open.
  React.useEffect(() => {
    if (isOpen) {
      fitAddonRef.current?.fit();
    }
  }, [height, isOpen]);

  // --- imperative handle ---
  React.useImperativeHandle(ref, () => ({
    write(text: string) {
      if (terminalRef.current) {
        terminalRef.current.write(text);
      } else {
        // Buffer for when the panel opens and xterm initializes.
        pendingWritesRef.current.push(text);
      }
    },
    clear() {
      terminalRef.current?.clear();
      pendingWritesRef.current = [];
    },
  }));

  // --- drag-to-resize ---
  const dragStartY = React.useRef<number>(0);
  const dragStartHeight = React.useRef<number>(0);

  function handleDragMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    dragStartY.current = e.clientY;
    dragStartHeight.current = height;
    e.preventDefault();

    const maxHeight = Math.floor(window.innerHeight * CLAMP_FRACTION);

    function onMouseMove(ev: MouseEvent) {
      // Dragging the top handle upward increases height (panel grows up).
      const delta = dragStartY.current - ev.clientY;
      const next = Math.max(
        MIN_HEIGHT,
        Math.min(maxHeight, dragStartHeight.current + delta)
      );
      setHeight(next);
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex flex-col rounded-md border border-border overflow-hidden"
      style={{
        backgroundColor: "var(--terminal-bg)",
      }}
    >
      {/* Drag handle — only shown when panel is open */}
      {isOpen && (
        <div
          onMouseDown={handleDragMouseDown}
          className="h-1.5 w-full shrink-0 cursor-ns-resize bg-border/40 hover:bg-border/70 transition-colors"
          aria-hidden="true"
        />
      )}

      {/* Toolbar */}
      <div className="bg-muted/40 border-b border-border flex items-center justify-between px-2 py-1 shrink-0">
        <span className="text-xs font-mono text-muted-foreground select-none">
          {title}
        </span>
        <div className="flex items-center gap-1">
          {isOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={() => terminalRef.current?.clear()}
            >
              Clear
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={isOpen ? "Collapse terminal" : "Expand terminal"}
            onClick={() => setIsOpen((prev) => !prev)}
          >
            {isOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronUp className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* xterm container — only rendered when open */}
      {isOpen && (
        <div
          ref={containerRef}
          style={{ height }}
          className="w-full overflow-hidden"
        />
      )}
    </div>
  );
});
