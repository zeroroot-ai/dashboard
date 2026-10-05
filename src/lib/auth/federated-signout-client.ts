// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Client-side start of a federated sign-out.
 *
 * A sign-out changes state, so the route accepts POST only. A menu item
 * cannot be a `<form>`, so it calls this function, which submits a form
 * that it builds. The browser makes a top-level navigation with the POST
 * method, and the route sends the browser to the identity provider.
 *
 * A page that the server renders uses a plain
 * `<form method="post" action="/api/auth/federated-signout">` and needs no
 * script.
 *
 * @module auth/federated-signout-client
 */

const FEDERATED_SIGNOUT_PATH = "/api/auth/federated-signout";

export function submitFederatedSignout(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = FEDERATED_SIGNOUT_PATH;
  form.hidden = true;
  document.body.appendChild(form);
  form.submit();
}
