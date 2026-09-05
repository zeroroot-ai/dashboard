import { describe, it, expect } from "vitest";
import {
  loginShapeForProviderType,
  loginShapeHint,
  loginShapeLabel,
} from "../login-shape";
import {
  SECRET_DOCUMENT_SHAPE_MESSAGE,
  isSecretDocumentField,
  validateSecretDocument,
} from "../secret-document";

describe("loginShapeForProviderType", () => {
  it.each([
    ["anthropic", "anthropic_api_key"],
    ["bedrock", "bedrock"],
    ["vertex", "vertex"],
    ["foundry", "foundry"],
  ])("maps provider type %s to login shape %s", (type, shape) => {
    expect(loginShapeForProviderType(type)).toBe(shape);
  });

  it.each(["openai", "ollama", "voyage", "", "Bedrock"])(
    "returns null for %j, bank members cannot run on it",
    (type) => {
      expect(loginShapeForProviderType(type)).toBeNull();
      expect(loginShapeHint(type)).toBeNull();
    },
  );

  it("names every shape for people", () => {
    expect(loginShapeLabel("anthropic_api_key")).toBe("Anthropic API key");
    expect(loginShapeLabel("bedrock")).toBe("Amazon Bedrock");
    expect(loginShapeLabel("vertex")).toBe("Google Vertex AI");
    expect(loginShapeLabel("foundry")).toBe("Microsoft Foundry");
  });

  it("hints with the shape label", () => {
    expect(loginShapeHint("vertex")).toContain("Google Vertex AI");
    expect(loginShapeHint("vertex")).toContain("Claude Code");
  });
});

describe("secret documents", () => {
  it("recognizes a secret field with a _json key and nothing else", () => {
    expect(isSecretDocumentField({ key: "google_application_credentials_json", secret: true })).toBe(true);
    expect(isSecretDocumentField({ key: "google_application_credentials_json", secret: false })).toBe(false);
    expect(isSecretDocumentField({ key: "foundry_api_key", secret: true })).toBe(false);
  });

  it("passes an empty value, the edit form keeps the stored document", () => {
    expect(validateSecretDocument("")).toBe(true);
    expect(validateSecretDocument("   ")).toBe(true);
    expect(validateSecretDocument(undefined)).toBe(true);
  });

  it("passes one JSON object", () => {
    expect(validateSecretDocument('{"type":"service_account","project_id":"p"}')).toBe(true);
  });

  it.each(['{"type":"service_account"', "not json", "[1,2]", '"a string"', "42"])(
    "refuses %j with the shape message",
    (value) => {
      expect(validateSecretDocument(value)).toBe(SECRET_DOCUMENT_SHAPE_MESSAGE);
    },
  );
});
