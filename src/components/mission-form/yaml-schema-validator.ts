/**
 * yaml-schema-validator — runs the vendored mission JSON Schema
 * against a YAML mission document and returns line-aware
 * validation messages suitable for Monaco markers.
 *
 * The schema is the one published by core/sdk's
 * mission-jsonschema-gen and vendored into
 * src/data/mission-definition.schema.json.
 *
 * Spec: mission-dashboard-rewrite Requirement 4 ACs 2, 3 + Task 10.
 */

"use client";

// Ajv 2020 supports JSON Schema draft 2020-12, which is what
// the SDK's mission-jsonschema-gen emits.
import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction, ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { parse as parseYaml, YAMLParseError } from "yaml";

import schema from "@/src/data/mission-definition.schema.json";

export interface YamlValidationMarker {
  /** 1-based line number. 0 if unknown. */
  line: number;
  /** Free-form description of the violation. */
  message: string;
  /** "error" or "warning". */
  severity: "error" | "warning";
  /** JSON Pointer-style path of the offending field. */
  path?: string;
}

let cachedValidate: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (cachedValidate) return cachedValidate;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  addFormats(ajv);
  cachedValidate = ajv.compile(schema as object);
  return cachedValidate;
}

export function validateMissionYaml(yamlSource: string): YamlValidationMarker[] {
  if (!yamlSource.trim()) {
    return [];
  }

  // YAML parse — surface YAML errors as line-aware markers.
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlSource);
  } catch (e) {
    if (e instanceof YAMLParseError) {
      return [
        {
          line: (e.linePos?.[0]?.line ?? 0) + 0,
          message: e.message,
          severity: "error",
        },
      ];
    }
    return [
      {
        line: 0,
        message: String((e as Error).message ?? e),
        severity: "error",
      },
    ];
  }

  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  // Schema-validate the parsed value.
  const validate = getValidator();
  const valid = validate(parsed);
  if (valid) return [];

  return (validate.errors ?? []).map(errToMarker);
}

function errToMarker(err: ErrorObject): YamlValidationMarker {
  // ajv's instancePath looks like "/nodes/scan/agent_config".
  // Trace into the YAML AST to find a line number is non-trivial
  // without a YAML AST library; surface line=0 (Monaco displays
  // at top of file) and rely on the path text in the message.
  const path = err.instancePath || "(root)";
  const detail = err.message ?? "schema violation";
  return {
    line: 0,
    message: `${path}: ${detail}`,
    severity: "error",
    path,
  };
}
