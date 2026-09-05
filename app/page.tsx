/**
 * Root page — self-hosted front door.
 *
 * ADR-0006 / deploy#1033: the marketing surface (home / pricing / contact-sales)
 * has moved to the SaaS-only www-svc (zeroroot-ai/www) served at www.zeroroot.ai.
 * The dashboard no longer serves go-to-market pages.
 *
 * Per ADR-0006: self-hosted `GET /` = the **login** page.
 *
 * On the SaaS deployment the dashboard is served at app.zeroroot.ai. The Envoy
 * www vhost routes to the www-svc nginx instead of this app, so this file is
 * never served at www.zeroroot.ai in SaaS. When HOST_SPLIT is active (SaaS),
 * the middleware already redirects app.zeroroot.ai `/` to `/dashboard` before
 * this component is reached.
 *
 * On self-hosted, WWW_URL is unset so HOST_SPLIT is null and the middleware
 * does not redirect `/`. This root page then serves as the front door, and the
 * correct front door for a self-hosted install with no marketing surface is the
 * login page.
 *
 * References: dashboard#823 (dashboard sheds go-to-market), deploy#1033.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function RootPage() {
  redirect("/login");
}
