import { expect, test } from "vitest";
import { sellerLimitReached, jobPublicationEntitlement } from "./plan-entitlements";
test("seller product quotas count parent products at the boundary", () => {
  expect(sellerLimitReached("free", "storedProducts", 49)).toBe(false);
  expect(sellerLimitReached("free", "storedProducts", 50)).toBe(true);
  expect(sellerLimitReached("free", "publicProducts", 30)).toBe(true);
  expect(sellerLimitReached("pro", "storedProducts", 200)).toBe(true);
  expect(sellerLimitReached("plus", "publicProducts", 500)).toBe(true);
  expect(sellerLimitReached("ultra", "storedProducts", 100000)).toBe(false);
});
test("jobs consume lifetime free approvals before paid monthly credits", () => {
  const input = { lifetimeApproved: 9, paidPeriodApproved: 30, paidPeriodActive: true, alreadyPublished: false };
  expect(jobPublicationEntitlement(input)).toBe("free");
  expect(jobPublicationEntitlement({ ...input, lifetimeApproved: 10 })).toBeNull();
  expect(jobPublicationEntitlement({ ...input, lifetimeApproved: 10, paidPeriodApproved: 29 })).toBe("paid");
  expect(jobPublicationEntitlement({ ...input, lifetimeApproved: 10, paidPeriodApproved: 0, paidPeriodActive: false })).toBeNull();
  expect(jobPublicationEntitlement({ ...input, lifetimeApproved: 10, alreadyPublished: true })).toBe("existing");
});
