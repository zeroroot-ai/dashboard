/**
 * Shared Zod schemas for API request validation.
 *
 * Provides reusable, security-focused schemas that prevent SSRF,
 * path-traversal, and oversized-payload attacks at the validation layer.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Internal-network and metadata-endpoint blocklist
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAME_PREFIXES = [
  'fd00:',
  '10.',
  '192.168.',
];

const BLOCKED_HOSTNAMES = new Set([
  '169.254.169.254',
  'metadata.google.internal',
]);

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;

  // 172.16.0.0 – 172.31.255.255
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;

  return BLOCKED_HOSTNAME_PREFIXES.some((prefix) => hostname.startsWith(prefix));
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Validates a URL string, blocking internal/metadata endpoints and
 * restricting protocols to http(s) to prevent SSRF.
 */
export const safeUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
        if (isBlockedHostname(parsed.hostname)) return false;
        return true;
      } catch {
        return false;
      }
    },
    {
      message:
        'URL is not allowed, cannot point to internal services or metadata endpoints',
    },
  );

/**
 * Sanitises a filename by replacing dangerous characters with underscores.
 * Prevents path-traversal and null-byte injection in file operations.
 */
export const safeFilenameSchema = z
  .string()
  .max(255)
  .transform((s) => s.replace(/["\n\r\0/\\]/g, '_'));

/**
 * Validates a single chat message exchanged between user and assistant.
 * Content is capped at 100 000 characters to bound payload size.
 */
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(100_000),
});
