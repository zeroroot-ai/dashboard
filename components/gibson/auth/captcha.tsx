"use client";

/**
 * Client-side CAPTCHA widget.
 *
 * Renders either a Cloudflare Turnstile or hCaptcha challenge based on
 * `NEXT_PUBLIC_DASHBOARD_CAPTCHA_PROVIDER`. The provider's JS is loaded
 * once per page; the widget calls `onToken` with the response token
 * produced by the user completing the challenge. Servers must still
 * re-verify the token via `verifyCaptcha` in src/lib/auth/captcha.ts —
 * this component is a UI affordance only.
 *
 * Environment (all `NEXT_PUBLIC_*` — safe to ship to the browser):
 *   - NEXT_PUBLIC_DASHBOARD_CAPTCHA_PROVIDER : "turnstile" | "hcaptcha" |
 *     "disabled" | unset. When `disabled` or unset the component renders
 *     null (nothing is mounted, no script is injected, no token is ever
 *     produced).
 *   - NEXT_PUBLIC_DASHBOARD_CAPTCHA_SITE_KEY : the provider's public site
 *     key. Never confused with `DASHBOARD_CAPTCHA_SECRET_KEY`, which is
 *     server-only.
 *
 * CSP: the two script sources below must be allow-listed in the
 * middleware nonce CSP. Task 16 ("CSP refresh") is the orchestrator for
 * that change; for now the URLs are:
 *   TODO(task-16): add to connect-src + script-src in middleware.ts
 *     - https://challenges.cloudflare.com/turnstile/v0/api.js
 *     - https://js.hcaptcha.com/1/api.js
 *
 * The server-rendered shell never contains the secret; the Server Action
 * that consumes `token` is the only place the secret is known.
 */

import { useEffect, useId, useRef, type ReactElement } from "react";

type Provider = "turnstile" | "hcaptcha" | "disabled" | "unset";

interface CaptchaProps {
  /** Called with the provider-issued response token once the challenge passes. */
  onToken: (token: string) => void;
  /**
   * Optional action label forwarded to the provider (Turnstile
   * `data-action`). Helps analytics segment signup vs signin etc.
   */
  action?: string;
}

// Module-level guard so we inject the provider <script> at most once per
// page. React may re-render the component, and multiple forms on one
// page (e.g. sign-in + sign-up tabs) must share a single script tag.
let turnstileScriptInjected = false;
let hcaptchaScriptInjected = false;

function resolveProvider(): Provider {
  const raw = (
    process.env.NEXT_PUBLIC_DASHBOARD_CAPTCHA_PROVIDER ?? ""
  ).toLowerCase();
  if (raw === "turnstile") return "turnstile";
  if (raw === "hcaptcha") return "hcaptcha";
  if (raw === "disabled") return "disabled";
  return "unset";
}

function siteKey(): string {
  return process.env.NEXT_PUBLIC_DASHBOARD_CAPTCHA_SITE_KEY ?? "";
}

function ensureScript(src: string, injectedRef: { injected: boolean }): void {
  if (injectedRef.injected) return;
  if (typeof document === "undefined") return;
  // If a previous mount on another component already injected this
  // exact URL, reuse it.
  const existing = document.querySelector(
    `script[src="${src}"]`,
  ) as HTMLScriptElement | null;
  if (existing) {
    injectedRef.injected = true;
    return;
  }
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
  injectedRef.injected = true;
}

/**
 * Attach a uniquely-named global callback so the provider script can hand
 * us the token. Returns a cleanup function that removes the property when
 * the component unmounts so we don't leak closures on repeated mounts.
 */
function registerCallback(
  name: string,
  handler: (token: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  // Use any here: the global object is intentionally polymorphic for
  // third-party callback registration. We tightly scope the property name
  // so there is no realistic clash risk.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w[name] = handler;
  return () => {
    try {
      delete w[name];
    } catch {
      w[name] = undefined;
    }
  };
}

/**
 * CAPTCHA widget. Renders null when the provider is `disabled` or unset,
 * which is the default in local development so contributors do not need
 * to provision a real site key to run the app.
 */
export function Captcha(props: CaptchaProps): ReactElement | null {
  const provider = resolveProvider();
  const callbackId = useId().replace(/[^a-zA-Z0-9]/g, "_");
  // Hold the latest onToken in a ref so the registered global callback
  // always calls through to the newest handler, even after prop changes,
  // without having to re-register on every render.
  const onTokenRef = useRef(props.onToken);
  onTokenRef.current = props.onToken;

  useEffect(() => {
    if (provider !== "turnstile" && provider !== "hcaptcha") return;
    const callbackName = `__gibsonCaptchaCb_${callbackId}`;
    const cleanup = registerCallback(callbackName, (token: string) => {
      onTokenRef.current(token);
    });
    return cleanup;
    // callbackId is stable per component instance; provider is a primitive.
  }, [callbackId, provider]);

  useEffect(() => {
    if (provider === "turnstile") {
      const ref = { injected: turnstileScriptInjected };
      ensureScript(
        "https://challenges.cloudflare.com/turnstile/v0/api.js",
        ref,
      );
      turnstileScriptInjected = ref.injected;
    } else if (provider === "hcaptcha") {
      const ref = { injected: hcaptchaScriptInjected };
      ensureScript("https://js.hcaptcha.com/1/api.js", ref);
      hcaptchaScriptInjected = ref.injected;
    }
  }, [provider]);

  if (provider === "disabled" || provider === "unset") {
    return null;
  }

  const key = siteKey();
  if (key.length === 0) {
    // Without a public site key the provider script has nothing to
    // bind; refuse to render rather than producing a silently broken
    // widget.
    return null;
  }

  const callbackName = `__gibsonCaptchaCb_${callbackId}`;

  if (provider === "turnstile") {
    return (
      <div
        className="cf-turnstile"
        data-sitekey={key}
        data-callback={callbackName}
        data-action={props.action}
      />
    );
  }

  // provider === "hcaptcha"
  return (
    <div
      className="h-captcha"
      data-sitekey={key}
      data-callback={callbackName}
    />
  );
}
