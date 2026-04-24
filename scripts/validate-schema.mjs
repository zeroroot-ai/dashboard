#!/usr/bin/env node
/**
 * validate-schema.mjs — long-running stdin/stdout Zod validation server.
 *
 * Protocol (newline-delimited JSON on stdin/stdout):
 *
 *   Request (stdin, one JSON object per line):
 *     { "id": "<string>", "schemaRef": "<path>:<export>", "body": "<json-string>" }
 *
 *   Response (stdout, one JSON object per line):
 *     { "id": "<string>", "ok": true }
 *     { "id": "<string>", "ok": false, "error": "<human-readable Zod error>" }
 *
 * The process stays alive until stdin closes (EOF) or it receives a
 * { "op": "shutdown" } request.
 *
 * Requirements: R1.3, NFR Modularity (no third validation library — uses Zod
 * which is already a dashboard dependency).
 *
 * Design: Component 4 (shape_validator.go shells out to this script once and
 * keeps the process alive across calls via stdin/stdout protocol).
 */

import { createRequire } from 'module'
import path from 'path'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'

// ---------------------------------------------------------------------------
// Module resolution helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// The script lives in enterprise/platform/dashboard/scripts/; the dashboard
// root is one level up.
const DASHBOARD_ROOT = path.resolve(__dirname, '..')

// require() for dynamic CommonJS imports from the dashboard's node_modules.
const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// Schema cache — import each schema module at most once per process lifetime.
// ---------------------------------------------------------------------------

/** @type {Map<string, import('zod').ZodTypeAny>} */
const schemaCache = new Map()

/**
 * Resolve a schema reference of the form "src/lib/schemas/foo.ts:ExportName"
 * to a Zod schema object.
 *
 * @param {string} schemaRef - "<relative-path>:<export-name>"
 * @returns {Promise<import('zod').ZodTypeAny>}
 */
async function resolveSchema(schemaRef) {
  if (schemaCache.has(schemaRef)) {
    return schemaCache.get(schemaRef)
  }

  const colonIdx = schemaRef.lastIndexOf(':')
  if (colonIdx === -1) {
    throw new Error(`validate-schema: invalid schemaRef "${schemaRef}" — must be "<path>:<export>"`)
  }
  const relPath = schemaRef.slice(0, colonIdx)
  const exportName = schemaRef.slice(colonIdx + 1)

  // Resolve to an absolute path from the dashboard root.
  // Strip .ts extension and replace with nothing — the dashboard uses
  // ts-node/esm or Next.js transforms that resolve .ts imports.
  // Since this script runs in Node.js without a transpiler, we attempt to
  // import the compiled .js output from .next/server or fall back to a
  // direct dynamic import with tsx loader if available.
  const absPath = path.resolve(DASHBOARD_ROOT, relPath)

  let mod
  try {
    // Try direct dynamic import (works if tsx or ts-node/esm is the loader).
    mod = await import(absPath)
  } catch (importErr) {
    // Fall back: try replacing .ts with .js (built output).
    const jsPath = absPath.replace(/\.ts$/, '.js')
    try {
      mod = await import(jsPath)
    } catch (fallbackErr) {
      throw new Error(
        `validate-schema: could not import schema "${schemaRef}": ${importErr.message} (also tried ${jsPath}: ${fallbackErr.message})`
      )
    }
  }

  const schema = mod[exportName] ?? mod.default?.[exportName]
  if (!schema) {
    throw new Error(
      `validate-schema: export "${exportName}" not found in "${relPath}" — available: ${Object.keys(mod).join(', ')}`
    )
  }

  schemaCache.set(schemaRef, schema)
  return schema
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a JSON body against a Zod schema.
 *
 * @param {string} schemaRef - schema reference
 * @param {string} bodyJson  - JSON string to validate
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function validate(schemaRef, bodyJson) {
  if (!schemaRef) {
    // No schema configured — skip validation.
    return { ok: true }
  }

  let body
  try {
    body = JSON.parse(bodyJson)
  } catch (e) {
    return { ok: false, error: `validate-schema: body is not valid JSON: ${e.message}` }
  }

  let schema
  try {
    schema = await resolveSchema(schemaRef)
  } catch (e) {
    return { ok: false, error: e.message }
  }

  const result = schema.safeParse(body)
  if (result.success) {
    return { ok: true }
  }

  // Format Zod errors concisely.
  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ')
  return { ok: false, error: `zod: ${issues}` }
}

// ---------------------------------------------------------------------------
// stdin/stdout protocol
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let req
  try {
    req = JSON.parse(trimmed)
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: 'invalid JSON request' }) + '\n')
    return
  }

  // Shutdown sentinel.
  if (req.op === 'shutdown') {
    process.exit(0)
  }

  const { id, schemaRef, body } = req
  try {
    const result = await validate(schemaRef ?? null, body ?? '{}')
    process.stdout.write(JSON.stringify({ id, ...result }) + '\n')
  } catch (err) {
    process.stdout.write(
      JSON.stringify({ id, ok: false, error: `validate-schema: unexpected error: ${err.message}` }) + '\n'
    )
  }
})

rl.on('close', () => {
  // stdin closed — clean exit.
  process.exit(0)
})

// Signal to the Go parent that the process is ready.
process.stderr.write('validate-schema: ready\n')
