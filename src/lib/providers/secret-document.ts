/**
 * Secret documents in provider credential forms (gibson#1706 lane E6).
 *
 * Most secret credential fields are one line: an API key, an access key id.
 * A few are a whole document, for example the Google service-account key a
 * Vertex configuration needs. The daemon marks such a field secret and names
 * it with a `_json` suffix. The form shows it as a multi-line box and checks
 * the shape before the value leaves the browser, so a truncated paste fails
 * here with a clear message instead of at the daemon with a vague one.
 *
 * The value is write-only, like every secret field: the daemon returns a
 * masked value after save, and the edit form leaves the field blank.
 */

import type { CredentialFieldDescriptor } from "@/src/lib/gibson-client-types";

/** True when a credential field carries a whole JSON document. */
export function isSecretDocumentField(cf: Pick<CredentialFieldDescriptor, "key" | "secret">): boolean {
  return cf.secret && cf.key.endsWith("_json");
}

/** The message a malformed document shows under the field. */
export const SECRET_DOCUMENT_SHAPE_MESSAGE =
  "Paste the whole JSON document. It must be one JSON object.";

/**
 * Validates a secret document value for react-hook-form. An empty value
 * passes, because the edit form keeps the stored value when the field is
 * blank. A non-empty value must parse as one JSON object.
 */
export function validateSecretDocument(value: unknown): true | string {
  if (typeof value !== "string" || value.trim() === "") return true;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return true;
  } catch {
    // fall through to the message
  }
  return SECRET_DOCUMENT_SHAPE_MESSAGE;
}
