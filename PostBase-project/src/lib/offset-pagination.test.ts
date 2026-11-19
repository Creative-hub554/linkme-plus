import { expect, test } from "vitest";
import { offsetPagination } from "./offset-pagination";
test("bounds malformed, zero and extreme page sizes", () => {
  expect(offsetPagination(new URLSearchParams("page=-1&limit=NaN"))).toEqual({
    page: 1,
    limit: 20,
    offset: 0,
  });
  expect(offsetPagination(new URLSearchParams("page=0&limit=0"))).toEqual({
    page: 1,
    limit: 1,
    offset: 0,
  });
  expect(
    offsetPagination(
      new URLSearchParams(
        "page=999999999999999999999&limit=99999999999999999999",
      ),
    ),
  ).toEqual({ page: 10000, limit: 100, offset: 999900 });
  expect(offsetPagination(new URLSearchParams("page=2&limit=10"))).toEqual({
    page: 2,
    limit: 10,
    offset: 10,
  });
});
