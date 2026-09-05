/**
 * Module declarations for packages that are not yet installed
 * or require type stubs for TypeScript compilation.
 */

// Monaco Editor - loaded dynamically via CDN or webpack
declare module 'monaco-editor' {
  export const MarkerSeverity: {
    Error: number;
    Warning: number;
    Info: number;
    Hint: number;
  };

  export interface IMarkerData {
    severity: number;
    message: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    source?: string;
    code?: string | { value: string; target: unknown };
  }

  export type IDisposable = { dispose: () => void };

  export interface Position {
    lineNumber: number;
    column: number;
  }

  export interface IRange {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }

  export interface IWordAtPosition {
    word: string;
    startColumn: number;
    endColumn: number;
  }

  export namespace editor {
    interface ITextModel {
      getValue: () => string;
      getLineContent: (lineNumber: number) => string;
      getLineCount: () => number;
      getValueInRange: (range: IRange) => string;
      getWordUntilPosition: (position: Position) => IWordAtPosition;
    }
    function create(element: HTMLElement, options?: Record<string, unknown>): ICodeEditor;
    function createModel(value: string, language?: string): ITextModel;
    function setModelMarkers(model: ITextModel, owner: string, markers: IMarkerData[]): void;
    interface ICodeEditor {
      getValue: () => string;
      setValue: (value: string) => void;
      dispose: () => void;
      onDidChangeModelContent: (listener: () => void) => IDisposable;
    }
  }

  export namespace languages {
    function registerCompletionItemProvider(
      language: string,
      provider: CompletionItemProvider
    ): IDisposable;
    const CompletionItemKind: Record<string, number>;
    const CompletionItemInsertTextRule: Record<string, number>;
    type ProviderResult<T> = T | null | undefined | Promise<T | null | undefined>;
    interface CompletionItemProvider {
      triggerCharacters?: string[];
      provideCompletionItems: (
        model: editor.ITextModel,
        position: Position
      ) => ProviderResult<CompletionList>;
    }
    interface CompletionList {
      suggestions: CompletionItem[];
    }
    interface CompletionItem {
      label: string;
      kind: number;
      insertText: string;
      insertTextRules?: number;
      documentation?: string;
      detail?: string;
      range?: IRange | { insert: IRange; replace: IRange };
    }
  }
}

// JSON Schema types
declare module 'json-schema' {
  export interface JSONSchema4 {
    id?: string;
    $schema?: string;
    title?: string;
    description?: string;
    type?: string | string[];
    properties?: Record<string, JSONSchema4>;
    required?: string[];
    additionalProperties?: boolean | JSONSchema4;
    items?: JSONSchema4 | JSONSchema4[];
    [key: string]: unknown;
  }
  export type JSONSchema7 = JSONSchema4;
}

// OpenTelemetry API
declare module '@opentelemetry/api' {
  export const trace: {
    getTracer: (name: string, version?: string) => Tracer;
  };
  export enum SpanKind {
    INTERNAL = 0,
    SERVER = 1,
    CLIENT = 2,
    PRODUCER = 3,
    CONSUMER = 4,
  }
  export const SpanStatusCode: {
    UNSET: number;
    OK: number;
    ERROR: number;
  };
  export const context: {
    active: () => unknown;
    with: (ctx: unknown, fn: () => unknown) => unknown;
  };
  export const propagation: {
    inject: (ctx: unknown, carrier: unknown) => void;
    extract: (ctx: unknown, carrier: unknown) => unknown;
  };
  export interface Span {
    setAttribute: (key: string, value: unknown) => void;
    setAttributes: (attributes: Record<string, unknown>) => void;
    setStatus: (status: { code: number; message?: string }) => void;
    addEvent: (name: string, attributes?: Record<string, unknown>) => void;
    end: () => void;
    spanContext: () => SpanContext;
    recordException: (error: unknown) => void;
  }
  export interface Tracer {
    startSpan: (name: string, options?: unknown) => Span;
    startActiveSpan: <T>(name: string, fn: (span: Span) => T) => T;
  }
  export interface SpanContext {
    traceId: string;
    spanId: string;
    traceFlags: number;
  }
}

// React Syntax Highlighter
declare module 'react-syntax-highlighter' {
  import type { ComponentType } from 'react';
  const SyntaxHighlighter: ComponentType<{
    language?: string;
    style?: Record<string, unknown>;
    children?: string;
    [key: string]: unknown;
  }>;
  export default SyntaxHighlighter;
  export const Prism: ComponentType<{
    language?: string;
    style?: Record<string, unknown>;
    children?: string;
    [key: string]: unknown;
  }>;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  const styles: Record<string, Record<string, unknown>>;
  export default styles;
  export const oneDark: Record<string, unknown>;
  export const vscDarkPlus: Record<string, unknown>;
}

declare module 'react-syntax-highlighter/dist/esm/styles/hljs' {
  const styles: Record<string, Record<string, unknown>>;
  export default styles;
  export const docco: Record<string, unknown>;
}
