import { describe, expect, it } from "vitest";

import { apiErrorMessage, futureLocalDateTimeToIso } from "@/lib/schedule-utils";

describe("schedule request helpers", () => {
  it("converts a future local datetime to an ISO instant", () => {
    const value = "2035-01-02T12:30";
    expect(futureLocalDateTimeToIso(value, 0)).toBe(new Date(value).toISOString());
  });

  it("rejects missing, invalid, and past one-shot dates", () => {
    expect(() => futureLocalDateTimeToIso("", 0)).toThrow("required");
    expect(() => futureLocalDateTimeToIso("not-a-date", 0)).toThrow("invalid");
    expect(() => futureLocalDateTimeToIso("2020-01-01T00:00", Date.now())).toThrow("future");
  });

  it("surfaces FastAPI validation details", () => {
    expect(apiErrorMessage(
      { response: { data: { detail: [{ msg: "run_at is required" }] } } },
      "failed",
    )).toBe("run_at is required");
  });
});
