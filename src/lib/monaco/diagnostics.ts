/**
 * Monaco Diagnostics Provider
 *
 * Converts validation errors to Monaco editor markers for inline display.
 * Features:
 * - Convert ValidationError to Monaco MarkerData
 * - Support for error, warning, and info severity levels
 * - Line and column positioning
 * - Marker lifecycle management
 */

import type { ValidationError, ValidationWarning } from '@/src/types/mission-creation';

// ============================================================================
// Types
// ============================================================================

// Monaco types - we use string-based types to avoid importing monaco at build time
type MonacoSeverity = 1 | 2 | 4 | 8; // Error, Warning, Info, Hint

export interface MonacoMarkerData {
  severity: MonacoSeverity;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  source?: string;
  code?: string | { value: string; target: { toString(): string } };
  relatedInformation?: Array<{
    resource: { toString(): string };
    message: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }>;
}

export interface DiagnosticsProviderOptions {
  /** Owner identifier for markers */
  owner?: string;
  /** Whether to include code in markers */
  includeCode?: boolean;
}

// ============================================================================
// Severity Mapping
// ============================================================================

const SEVERITY_MAP: Record<string, MonacoSeverity> = {
  error: 8, // monaco.MarkerSeverity.Error
  warning: 4, // monaco.MarkerSeverity.Warning
  info: 2, // monaco.MarkerSeverity.Info
  hint: 1, // monaco.MarkerSeverity.Hint
};

function getSeverity(severity: string): MonacoSeverity {
  return SEVERITY_MAP[severity] || SEVERITY_MAP.info;
}

// ============================================================================
// Marker Conversion
// ============================================================================

/**
 * Convert a ValidationError to Monaco MarkerData
 */
export function errorToMarker(
  error: ValidationError,
  options: DiagnosticsProviderOptions = {}
): MonacoMarkerData {
  const { includeCode = true } = options;

  // Estimate end column based on path length or default
  const pathLength = error.path?.split('.').pop()?.length || 10;

  return {
    severity: getSeverity(error.severity),
    message: error.message,
    startLineNumber: error.line || 1,
    startColumn: error.column || 1,
    endLineNumber: error.line || 1,
    endColumn: (error.column || 1) + pathLength,
    source: 'Mission Validation',
    ...(includeCode && error.code && { code: error.code }),
  };
}

/**
 * Convert a ValidationWarning to Monaco MarkerData
 */
export function warningToMarker(
  warning: ValidationWarning,
  options: DiagnosticsProviderOptions = {}
): MonacoMarkerData {
  const { includeCode = true } = options;

  // Warnings typically don't have line numbers, use path to estimate
  const pathLength = warning.path?.split('.').pop()?.length || 10;

  return {
    severity: getSeverity(warning.severity),
    message: warning.suggestion
      ? `${warning.message}\n\nSuggestion: ${warning.suggestion}`
      : warning.message,
    startLineNumber: 1, // Warnings without line numbers show at top
    startColumn: 1,
    endLineNumber: 1,
    endColumn: pathLength,
    source: 'Mission Validation',
    ...(includeCode && warning.code && { code: warning.code }),
  };
}

/**
 * Convert arrays of errors and warnings to Monaco markers
 */
export function toMonacoMarkers(
  errors: ValidationError[],
  warnings: ValidationWarning[],
  options: DiagnosticsProviderOptions = {}
): MonacoMarkerData[] {
  const markers: MonacoMarkerData[] = [];

  // Convert errors
  for (const error of errors) {
    markers.push(errorToMarker(error, options));
  }

  // Convert warnings
  for (const warning of warnings) {
    markers.push(warningToMarker(warning, options));
  }

  return markers;
}

// ============================================================================
// Monaco Integration Functions
// ============================================================================

/**
 * Set markers on a Monaco model
 *
 * @param monaco - Monaco namespace
 * @param model - Text model to set markers on
 * @param markers - Markers to set
 * @param owner - Owner identifier (default: 'mission-validation')
 */
export function setModelMarkers(
  monaco: typeof import('monaco-editor'),
  model: import('monaco-editor').editor.ITextModel,
  markers: MonacoMarkerData[],
  owner: string = 'mission-validation'
): void {
  monaco.editor.setModelMarkers(model, owner, markers);
}

/**
 * Clear markers from a Monaco model
 */
export function clearModelMarkers(
  monaco: typeof import('monaco-editor'),
  model: import('monaco-editor').editor.ITextModel,
  owner: string = 'mission-validation'
): void {
  monaco.editor.setModelMarkers(model, owner, []);
}

/**
 * Update markers based on validation results
 */
export function updateMarkers(
  monaco: typeof import('monaco-editor'),
  model: import('monaco-editor').editor.ITextModel,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  options: DiagnosticsProviderOptions = {}
): void {
  const owner = options.owner || 'mission-validation';
  const markers = toMonacoMarkers(errors, warnings, options);
  setModelMarkers(monaco, model, markers, owner);
}

// ============================================================================
// Diagnostics Provider Class
// ============================================================================

/**
 * DiagnosticsProvider manages Monaco markers for mission validation
 */
export class MissionDiagnosticsProvider {
  private monaco: typeof import('monaco-editor') | null = null;
  private model: import('monaco-editor').editor.ITextModel | null = null;
  private owner: string;
  private includeCode: boolean;

  constructor(options: DiagnosticsProviderOptions = {}) {
    this.owner = options.owner || 'mission-validation';
    this.includeCode = options.includeCode ?? true;
  }

  /**
   * Initialize with Monaco and model
   */
  initialize(
    monaco: typeof import('monaco-editor'),
    model: import('monaco-editor').editor.ITextModel
  ): void {
    this.monaco = monaco;
    this.model = model;
  }

  /**
   * Update diagnostics with new validation results
   */
  update(errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (!this.monaco || !this.model) {
      console.warn('[DiagnosticsProvider] Not initialized');
      return;
    }

    updateMarkers(this.monaco, this.model, errors, warnings, {
      owner: this.owner,
      includeCode: this.includeCode,
    });
  }

  /**
   * Clear all diagnostics
   */
  clear(): void {
    if (!this.monaco || !this.model) return;
    clearModelMarkers(this.monaco, this.model, this.owner);
  }

  /**
   * Dispose the provider
   */
  dispose(): void {
    this.clear();
    this.monaco = null;
    this.model = null;
  }
}

// ============================================================================
// Hook-friendly Functions
// ============================================================================

/**
 * Create a diagnostics updater function
 * Useful for React hooks
 */
export function createDiagnosticsUpdater(
  monaco: typeof import('monaco-editor'),
  model: import('monaco-editor').editor.ITextModel,
  options: DiagnosticsProviderOptions = {}
) {
  const owner = options.owner || 'mission-validation';

  return {
    update: (errors: ValidationError[], warnings: ValidationWarning[]) => {
      updateMarkers(monaco, model, errors, warnings, { ...options, owner });
    },
    clear: () => {
      clearModelMarkers(monaco, model, owner);
    },
  };
}

// ============================================================================
// Export
// ============================================================================

export default MissionDiagnosticsProvider;
