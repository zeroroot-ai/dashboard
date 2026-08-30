/**
 * One xterm factory for every console surface (dashboard#1146).
 *
 * The mission terminal and the wall tiles open xterm the same way: the
 * locked acid-concrete palette, the brand mono font, and a fit addon. The
 * font family is the one runtime read. next/font sets the loaded family
 * name in `--font-jetbrains-mono`, and a `var()` in a canvas font string
 * does not resolve, so the value is read and passed as text.
 */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TERMINAL_THEME } from "@/src/lib/graph/theme-colors";

const FALLBACK_MONO = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';

/** Resolves the brand mono font family for xterm. */
function resolveMonoFontFamily(): string {
  if (typeof document === "undefined") return FALLBACK_MONO;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-jetbrains-mono")
    .trim();
  return v.length > 0 ? `${v}, ${FALLBACK_MONO}` : FALLBACK_MONO;
}

interface ConsoleTerminalOptions {
  fontSize?: number;
  lineHeight?: number;
  scrollback?: number;
}

export interface ConsoleTerminal {
  terminal: Terminal;
  /** Fits the terminal to its container. */
  fit: () => void;
  dispose: () => void;
}

/** Opens a themed, fitted xterm inside `container`. */
export function openConsoleTerminal(
  container: HTMLElement,
  opts: ConsoleTerminalOptions = {},
): ConsoleTerminal {
  const terminal = new Terminal({
    theme: TERMINAL_THEME,
    convertEol: true,
    scrollback: opts.scrollback ?? 5000,
    fontFamily: resolveMonoFontFamily(),
    fontSize: opts.fontSize ?? 14,
    lineHeight: opts.lineHeight ?? 1.4,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  fitAddon.fit();
  return {
    terminal,
    fit: () => fitAddon.fit(),
    dispose: () => terminal.dispose(),
  };
}
