/**
 * Email primitive types shared by every provider and template.
 *
 * Keep this file dependency-free — it is imported by the default `log`
 * provider, every transactional template, and any server-side caller
 * that dispatches mail. Adding dependencies here forces them into the
 * bundle even for installs that only use the `log` provider.
 */

/**
 * A fully-rendered, ready-to-send email message.
 *
 * Templates render BOTH `html` and `text` bodies (never just one); email
 * clients that refuse HTML, spam filters that want a text alternative,
 * and accessibility tools that prefer plain text all rely on `text`
 * being a complete, self-contained version of the message.
 */
export interface EmailMessage {
  /** RFC 5322 recipient address. */
  to: string;
  /** Subject line; plain text, no Unicode control chars. */
  subject: string;
  /** HTML body (inline styles only, no remote images, no tracking pixels). */
  html: string;
  /** Plain-text body (MUST be complete, not a "see HTML version" stub). */
  text: string;
  /** Optional custom headers, e.g. `List-Unsubscribe`, `X-Entity-Ref-ID`. */
  headers?: Record<string, string>;
}

/**
 * Common interface every provider implements.
 *
 * Dispatch errors MUST be thrown, never swallowed — callers decide
 * retry behaviour (rate-limiter, audit log, user-visible error, etc.).
 */
export interface EmailProvider {
  send(msg: EmailMessage): Promise<void>;
}
