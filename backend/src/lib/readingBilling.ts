const NON_BILLABLE_READING_SYNC_PREFIXES = ["METER_REPLACEMENT_BASELINE:"] as const;

/**
 * Some approved readings establish an authoritative meter baseline but do not
 * represent consumption. They must remain available to subsequent readings,
 * without being treated as readings that require their own bill.
 */
export function readingRequiresBill(reading: { syncId?: string | null }) {
  return !NON_BILLABLE_READING_SYNC_PREFIXES.some((prefix) => reading.syncId?.startsWith(prefix));
}
