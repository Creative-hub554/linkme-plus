export const sellerPlans = {
  free: { storedProducts: 50, publicProducts: 30 },
  pro: { storedProducts: 200, publicProducts: 200 },
  plus: { storedProducts: 500, publicProducts: 500 },
  ultra: { storedProducts: null, publicProducts: null },
} as const;
export type SellerPlan = keyof typeof sellerPlans;
export const FREE_LIFETIME_JOBS = 10;
export const EMPLOYER_PERIOD_JOBS = 30;
export function isSellerPlan(value: unknown): value is SellerPlan {
  return typeof value === "string" && Object.hasOwn(sellerPlans, value);
}
export function sellerLimitReached(plan: SellerPlan, kind: "storedProducts" | "publicProducts", count: number): boolean {
  const limit = sellerPlans[plan][kind];
  return limit !== null && count >= limit;
}
export function jobPublicationEntitlement(input: { lifetimeApproved: number; paidPeriodApproved: number; paidPeriodActive: boolean; alreadyPublished: boolean }): "existing" | "free" | "paid" | null {
  if (input.alreadyPublished) return "existing";
  if (input.lifetimeApproved < FREE_LIFETIME_JOBS) return "free";
  if (input.paidPeriodActive && input.paidPeriodApproved < EMPLOYER_PERIOD_JOBS) return "paid";
  return null;
}
