import { afterEach, expect, test, vi } from "vitest";
import { evidenceAccessSignature, verifyEvidenceAccess, privateEvidenceBucket } from "./private-evidence";
afterEach(() => vi.unstubAllEnvs());
test("private evidence cannot fall back to public media storage", () => {
  vi.stubEnv("R2_PRIVATE_BUCKET_NAME", "");
  expect(() => privateEvidenceBucket()).toThrow("Private evidence storage is not configured");
});
test("evidence links expire quickly and are bound to both member and document", () => {
  vi.stubEnv("AUTH_SECRET", "private-evidence-test-secret-at-least-32-characters");
  const expires = Math.floor(Date.now() / 1000) + 90;
  const signature = evidenceAccessSignature("reviewer", "document", expires);
  expect(verifyEvidenceAccess("reviewer", "document", expires, signature)).toBe(true);
  expect(verifyEvidenceAccess("other-member", "document", expires, signature)).toBe(false);
  expect(verifyEvidenceAccess("reviewer", "other-document", expires, signature)).toBe(false);
  expect(verifyEvidenceAccess("reviewer", "document", expires + 1000, signature)).toBe(false);
  expect(verifyEvidenceAccess("reviewer", "document", 0, signature)).toBe(false);
});
