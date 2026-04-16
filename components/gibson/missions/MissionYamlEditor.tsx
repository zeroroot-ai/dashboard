"use client";

import { useRef, useEffect } from "react";
import Editor, { type Monaco, type OnMount, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

// Use locally installed monaco-editor instead of CDN (CSP blocks CDN scripts)
loader.config({ monaco });

interface ValidationError {
  line?: number;
  column?: number;
  message: string;
}

interface MissionYamlEditorProps {
  value: string;
  onChange: (value: string) => void;
  errors?: ValidationError[];
  readOnly?: boolean;
}

export default function MissionYamlEditor({
  value,
  onChange,
  errors = [],
  readOnly = false,
}: MissionYamlEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  // Map validation errors to Monaco markers
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const markers = errors.filter((err) => err.line != null).map((err) => ({
      severity: monaco.MarkerSeverity.Error,
      startLineNumber: err.line!,
      startColumn: err.column || 1,
      endLineNumber: err.line!,
      endColumn: 1000,
      message: err.message,
    }));

    monaco.editor.setModelMarkers(model, "mission-validation", markers);
  }, [errors]);

  return (
    <Editor
      language="yaml"
      theme="vs-dark"
      value={value}
      onChange={(val) => onChange(val || "")}
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
