import { describe, it, expect } from "vitest";

import {
  validateVaultAddress,
  MAX_VAULT_ADDRESS_LENGTH,
  type VaultAddressValidation,
} from "@/src/lib/validators/vault-address";

function reason(raw: string): string {
  const result: VaultAddressValidation = validateVaultAddress(raw);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.reason;
}

describe("validateVaultAddress", () => {
  describe("accepts a well-formed public https address", () => {
    it.each([
      "https://vault.example.com",
      "https://vault.example.com/",
      "https://vault.example.com:8200",
      "https://vault.eu-west-1.example.co.uk:8200/prefix",
      "https://8.8.8.8:8200",
      "https://[2606:4700:4700::1111]:8200",
    ])("%s", (address) => {
      expect(validateVaultAddress(address).ok).toBe(true);
    });

    it("normalises the address it hands on", () => {
      const result = validateVaultAddress("  https://Vault.Example.com:8200/  ");
      expect(result).toEqual({
        ok: true,
        normalized: "https://vault.example.com:8200",
      });
    });
  });

  describe("rejects addresses aimed at internal space", () => {
    it.each([
      // Loopback, in every spelling the URL parser normalises.
      "https://127.0.0.1:8200",
      "https://127.99.12.4:8200",
      "https://2130706433:8200",
      "https://0x7f.0.0.1:8200",
      "https://0177.0.0.1:8200",
      "https://[::1]:8200",
      "https://[::ffff:127.0.0.1]:8200",
      // RFC1918.
      "https://10.0.0.1:8200",
      "https://172.16.4.9:8200",
      "https://172.31.255.254:8200",
      "https://192.168.1.1:8200",
      // Link-local, including the cloud instance-metadata address.
      "https://169.254.169.254/latest/meta-data",
      "https://[fe80::1]:8200",
      // Unique-local IPv6 and CGNAT.
      "https://[fd00::1]:8200",
      "https://100.64.0.1:8200",
      // Unspecified / broadcast / multicast.
      "https://0.0.0.0:8200",
      "https://255.255.255.255:8200",
      "https://224.0.0.1:8200",
    ])("%s", (address) => {
      expect(validateVaultAddress(address).ok).toBe(false);
    });

    it.each([
      "https://localhost:8200",
      "https://vault.default.svc.cluster.local:8200",
      "https://gibson-openbao.gibson.svc:8200",
      "https://printer.local:8200",
      "https://metadata.google.internal/computeMetadata/v1",
      "https://db.internal:8200",
    ])("%s", (address) => {
      expect(validateVaultAddress(address).ok).toBe(false);
    });

    it("rejects a single-label host that would resolve through cluster search domains", () => {
      expect(reason("https://vault:8200")).toMatch(/fully-qualified/i);
    });
  });

  describe("rejects unsafe URL shapes", () => {
    it("rejects plain http, with no environment escape hatch", () => {
      expect(reason("http://vault.example.com:8200")).toMatch(/https/i);
    });

    it.each(["file:///etc/passwd", "gopher://vault.example.com", "vault.example.com:8200"])(
      "rejects non-https scheme %s",
      (address) => {
        expect(validateVaultAddress(address).ok).toBe(false);
      },
    );

    it("rejects embedded credentials", () => {
      expect(reason("https://user:pass@vault.example.com")).toMatch(
        /username or password/i,
      );
    });

    it("rejects a query string or fragment", () => {
      expect(reason("https://vault.example.com?a=1")).toMatch(/query/i);
      expect(reason("https://vault.example.com#frag")).toMatch(/fragment/i);
    });

    it("rejects an empty address", () => {
      expect(reason("")).toMatch(/required/i);
      expect(reason("   ")).toMatch(/required/i);
    });

    it("rejects an over-long address", () => {
      const long = "https://" + "a".repeat(MAX_VAULT_ADDRESS_LENGTH) + ".example.com";
      expect(reason(long)).toMatch(/at most/i);
    });

    it("rejects control characters used for request splitting", () => {
      expect(reason("https://vault.example.com\r\nX-Injected: 1")).toMatch(
        /whitespace or control/i,
      );
    });

    it("does not reject a legitimate hyphenated host", () => {
      expect(validateVaultAddress("https://vault-prod-01.example.com").ok).toBe(true);
    });
  });
});
