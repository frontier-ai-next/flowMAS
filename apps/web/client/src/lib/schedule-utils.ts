export function futureLocalDateTimeToIso(value: string, nowMs = Date.now()): string {
  if (!value.trim()) throw new Error("Run date and time are required");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Run date and time are invalid");
  if (date.getTime() <= nowMs) throw new Error("Run date and time must be in the future");
  return date.toISOString();
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { detail?: unknown } } })?.response;
  const detail = response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map(item => (item as { msg?: unknown })?.msg)
      .filter((value): value is string => typeof value === "string" && !!value);
    if (messages.length) return messages.join("; ");
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
