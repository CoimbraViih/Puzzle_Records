import { describe, expect, it } from "vitest";
import { isAllowedTransferHost } from "./cutproTransfer";

describe("isAllowedTransferHost", () => {
  it("allows the Cut.Pro API host", () => {
    expect(isAllowedTransferHost("https://api.cutpro.io/uploads/abc")).toBe(true);
  });

  it("allows subdomains of the allowlisted hosts", () => {
    expect(isAllowedTransferHost("https://storage.cutpro.io/x")).toBe(true);
  });

  it("rejects an unrelated host", () => {
    expect(isAllowedTransferHost("https://evil.example.com/x")).toBe(false);
  });

  it("rejects a host that merely contains the allowlisted domain as a suffix of a longer label", () => {
    expect(isAllowedTransferHost("https://notcutpro.io/x")).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isAllowedTransferHost("not-a-url")).toBe(false);
  });
});
