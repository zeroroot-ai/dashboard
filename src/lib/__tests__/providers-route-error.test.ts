// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

vi.mock("@/src/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { ADDRESS_REFUSED_MESSAGE } from "@/src/lib/errors/address-refusal";
import { translateError } from "../providers-route-error";

describe("translateError", () => {
  it("shows a fixed text for a refused base_url host, with no resolved address", async () => {
    const err = new ConnectError(
      "base_url host is refused: llm.corp.example resolves to 172.16.3.9, a private address",
      Code.InvalidArgument,
    );
    const res = translateError(err);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.message).toBe(ADDRESS_REFUSED_MESSAGE);
    expect(JSON.stringify(body)).not.toMatch(/172\.16|resolves to/);
  });

  it("keeps the text of another validation error", async () => {
    const res = translateError(new ConnectError("base_url has no host", Code.InvalidArgument));
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("base_url has no host");
  });
});
