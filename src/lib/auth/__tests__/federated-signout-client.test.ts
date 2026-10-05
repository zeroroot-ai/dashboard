// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * @vitest-environment jsdom
 *
 * The sign-out route accepts POST only. The menus start a sign-out through
 * `submitFederatedSignout`, so it must submit a POST form to that route and
 * never assign `window.location`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ERROR_COPY } from "../error-codes";
import { submitFederatedSignout } from "../federated-signout-client";

describe("submitFederatedSignout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("submits a POST form to the federated sign-out route", () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});

    submitFederatedSignout();

    expect(submit).toHaveBeenCalledTimes(1);
    const form = document.body.querySelector("form");
    expect(form).not.toBeNull();
    expect(form!.method.toLowerCase()).toBe("post");
    expect(new URL(form!.action).pathname).toBe("/api/auth/federated-signout");
  });
});

describe("the action of an error page that points at the sign-out route", () => {
  it("is always a POST", () => {
    for (const [reason, copy] of Object.entries(ERROR_COPY)) {
      if (copy.cta.href.includes("federated-signout")) {
        expect(copy.cta.method, reason).toBe("post");
      }
    }
    expect(ERROR_COPY.membership_revoked.cta.method).toBe("post");
  });
});
