// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";

import { isOfferedProviderType } from "../offered-types";

describe("isOfferedProviderType", () => {
  it.each(["anthropic", "openai", "openai-compatible", "bedrock", "google", "vertex"])(
    "offers %s",
    (t) => expect(isOfferedProviderType(t)).toBe(true),
  );

  it.each([
    "voyage",
    "cloudflare",
    "cohere",
    "huggingface",
    "llamafile",
    "mistral",
    "foundry",
    "ollama",
    "custom",
    "tei",
    "",
  ])("does not offer %s", (t) => expect(isOfferedProviderType(t)).toBe(false));
});
