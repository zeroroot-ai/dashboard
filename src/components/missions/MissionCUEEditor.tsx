"use client";

/**
 * MissionCUEEditor
 *
 * Monaco-based CUE editor for mission definitions. Wires three daemon language-
 * service RPCs via server actions:
 *
 *  - ValidateMissionCUE  → Monaco model markers (400 ms debounce)
 *  - CompleteMissionCUE  → Monaco completion item provider
 *  - HoverMissionCUE     → Monaco hover provider
 *
 * CUE is registered as a Monarch-tokenised language. There is no npm-published
 * TextMate grammar for CUE, so a lightweight Monarch ruleset covers strings,
 * numbers, identifiers, keywords, comments, and delimiters — sufficient for
 * syntax highlighting of the mission schema subset.
 *
 * Spec: dashboard#291.
 */

import { useEffect, useRef, useCallback } from "react";
import Editor, { type Monaco, type OnMount, loader } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";

// Use locally-installed monaco-editor instead of CDN (CSP blocks CDN scripts).
loader.config({ monaco: monacoEditor });

// CUE uses a Monarch tokenizer — no built-in Monaco language worker needed.
// We only need editor.worker for Monaco's internal editor machinery (bracket
// matching, autoindent, etc.). Without this, Monaco emits the
// "MonacoEnvironment.getWorkerUrl not defined" error and falls back to running
// on the main thread, which freezes the UI.
// The new URL() syntax is webpack 5 / Next.js 13+ Worker syntax; webpack emits
// the worker as a separate static chunk served from /_next/static/chunks/.
if (typeof window !== "undefined") {
  (
    window as unknown as {
      MonacoEnvironment?: {
        getWorker: (moduleId: string, label: string) => Worker;
      };
    }
  ).MonacoEnvironment = {
    getWorker(_moduleId: string, _label: string): Worker {
      return new Worker(
        new URL(
          "monaco-editor/esm/vs/editor/editor.worker",
          import.meta.url
        )
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Called whenever the diagnostic count changes (used by parent for status). */
  onDiagnosticsChange?: (count: number) => void;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// CUE language registration (runs once per Monaco instance)
// ---------------------------------------------------------------------------

let cueLanguageRegistered = false;

function registerCUELanguage(monaco: Monaco): void {
  if (cueLanguageRegistered) return;
  cueLanguageRegistered = true;

  monaco.languages.register({ id: "cue" });

  monaco.languages.setMonarchTokensProvider("cue", {
    keywords: [
      "import",
      "package",
      "if",
      "for",
      "let",
      "in",
      "null",
      "true",
      "false",
    ],
    tokenizer: {
      root: [
        // Line comments
        [/#.*$/, "comment"],
        // Double-quoted strings
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, "string"],
        // Single-quoted strings (bytes literals)
        [/'[^'\\]*(?:\\.[^'\\]*)*'/, "string"],
        // Multi-line strings — simplified single-line match
        [/"""[\s\S]*?"""/, "string"],
        // Numbers (integer and float)
        [/\b\d+(\.\d+)?\b/, "number"],
        // Keywords
        [
          /\b(?:import|package|if|for|let|in|null|true|false)\b/,
          "keyword",
        ],
        // Identifiers (fields, values)
        [/[a-zA-Z_#]\w*/, "identifier"],
        // Operators and punctuation
        [/[{}[\]()]/, "delimiter.bracket"],
        [/[,:]/, "delimiter"],
        [/[=|&<>!+\-*/]/, "operator"],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration("cue", {
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    comments: {
      lineComment: "#",
    },
    indentationRules: {
      increaseIndentPattern: /^.*\{[^}"']*$/,
      decreaseIndentPattern: /^.*\}$/,
    },
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MissionCUEEditor({
  value,
  onChange,
  onDiagnosticsChange,
  readOnly = false,
}: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const validateTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Dispose handles for providers registered per editor instance
  const completionDisposableRef = useRef<{ dispose(): void } | null>(null);
  const hoverDisposableRef = useRef<{ dispose(): void } | null>(null);

  // ----- Server action imports (lazy to avoid SSR issues) -----
  // These are server actions — they must be imported dynamically from a
  // "use client" module. Because Next.js serialises server actions through the
  // React boundary, dynamic import is safe here; the bundler replaces the
  // function body with an RPC stub automatically.
  const actionsRef = useRef<{
    validate: (src: string) => Promise<Array<{ line: number; col: number; message: string; severity: string }>>;
    complete: (src: string, line: number, col: number) => Promise<Array<{ label: string; detail: string; documentation: string; kind: string }>>;
    hover: (src: string, line: number, col: number) => Promise<string>;
  } | null>(null);

  useEffect(() => {
    void import("@/app/actions/missions/cue-editor").then((mod) => {
      actionsRef.current = {
        validate: mod.validateMissionCUEAction,
        complete: mod.completeMissionCUEAction,
        hover: mod.hoverMissionCUEAction,
      };
    });
  }, []);

  // ----- Run validation and populate Monaco model markers -----
  const runValidation = useCallback(
    async (source: string, monaco: Monaco, editor: Parameters<OnMount>[0]) => {
      const model = editor.getModel();
      if (!model || !actionsRef.current) return;

      try {
        const diagnostics = await actionsRef.current.validate(source);

        const markers = diagnostics.map((d) => ({
          severity:
            d.severity === "error" || d.severity === "ERROR"
              ? monaco.MarkerSeverity.Error
              : monaco.MarkerSeverity.Warning,
          startLineNumber: d.line || 1,
          startColumn: d.col || 1,
          endLineNumber: d.line || 1,
          endColumn: 1000,
          message: d.message,
        }));

        monaco.editor.setModelMarkers(model, "cue-daemon", markers);
        onDiagnosticsChange?.(diagnostics.filter((d) => d.severity === "error" || d.severity === "ERROR").length);
      } catch {
        // Network or authz error — clear markers silently
        const model = editor.getModel();
        if (model) monaco.editor.setModelMarkers(model, "cue-daemon", []);
      }
    },
    [onDiagnosticsChange]
  );

  // ----- Mount handler -----
  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      registerCUELanguage(monaco);

      // ----- Completion provider -----
      completionDisposableRef.current?.dispose();
      completionDisposableRef.current = monaco.languages.registerCompletionItemProvider(
        "cue",
        {
          triggerCharacters: [".", ":", " "],
          provideCompletionItems: async (
            model: monacoEditor.editor.ITextModel,
            position: monacoEditor.Position
          ) => {
            if (!actionsRef.current) return { suggestions: [] };
            try {
              const items = await actionsRef.current.complete(
                model.getValue(),
                position.lineNumber,
                position.column
              );
              const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: position.column,
                endColumn: position.column,
              };
              // Map the string kind to the Monaco enum value.
              // Unmapped kinds fall back to 'Text' (0).
              const kindMap: Record<string, number> = {
                field: monaco.languages.CompletionItemKind.Field,
                value: monaco.languages.CompletionItemKind.Value,
                keyword: monaco.languages.CompletionItemKind.Keyword,
              };
              return {
                suggestions: items.map((item) => ({
                  label: item.label,
                  kind: kindMap[item.kind] ?? monaco.languages.CompletionItemKind.Text,
                  detail: item.detail,
                  documentation: { value: item.documentation },
                  insertText: item.label,
                  range,
                })),
              };
            } catch {
              return { suggestions: [] };
            }
          },
        }
      );

      // ----- Hover provider -----
      hoverDisposableRef.current?.dispose();
      hoverDisposableRef.current = monaco.languages.registerHoverProvider("cue", {
        provideHover: async (
          model: monacoEditor.editor.ITextModel,
          position: monacoEditor.Position
        ) => {
          if (!actionsRef.current) return null;
          try {
            const markdown = await actionsRef.current.hover(
              model.getValue(),
              position.lineNumber,
              position.column
            );
            if (!markdown) return null;
            return {
              contents: [{ value: markdown }],
            };
          } catch {
            return null;
          }
        },
      });

      // Run initial validation
      void runValidation(editor.getValue(), monaco, editor);
    },
    [runValidation]
  );

  // ----- Debounced validation on value change -----
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    validateTimerRef.current = setTimeout(() => {
      void runValidation(value, monaco, editor);
    }, 400);

    return () => {
      if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    };
  }, [value, runValidation]);

  // ----- Cleanup on unmount -----
  useEffect(() => {
    return () => {
      if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
      completionDisposableRef.current?.dispose();
      hoverDisposableRef.current?.dispose();
    };
  }, []);

  return (
    <Editor
      language="cue"
      theme="vs-dark"
      value={value}
      onChange={(val) => onChange(val ?? "")}
      onMount={handleMount}
      loading={
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Loading editor...
        </div>
      }
      options={{
        readOnly,
        minimap: { enabled: false },
        lineNumbers: "on",
        wordWrap: "on",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 14,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        insertSpaces: true,
        renderWhitespace: "selection",
        folding: true,
        glyphMargin: true,
      }}
    />
  );
}

export default MissionCUEEditor;
