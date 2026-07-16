import { describe, expect, it } from "vitest";
import { isAllowedTransferHost } from "./cutproTransfer";

describe("isAllowedTransferHost", () => {
  it("allows the real Cut.Pro upload (S3) host", () => {
    expect(
      isAllowedTransferHost("https://cutpro-storage.s3.us-east-1.amazonaws.com/videos/abc")
    ).toBe(true);
  });

  it("allows the real Cut.Pro CDN download host", () => {
    expect(isAllowedTransferHost("https://cdn.cut.pro/editor/renders/123.mp4")).toBe(true);
  });

  it("allows subdomains of the allowlisted hosts", () => {
    expect(isAllowedTransferHost("https://x.cdn.cut.pro/y")).toBe(true);
  });

  it("rejects an unrelated host", () => {
    expect(isAllowedTransferHost("https://evil.example.com/x")).toBe(false);
  });

  it("rejects a host that merely contains the allowlisted domain as a suffix of a longer label", () => {
    expect(isAllowedTransferHost("https://notcdn.cut.pro.evil.com/x")).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isAllowedTransferHost("not-a-url")).toBe(false);
  });
});
