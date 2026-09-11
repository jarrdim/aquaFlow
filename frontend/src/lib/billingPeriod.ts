export type BillingCycleLabelSource = {
  cycleCode?: string | null;
  cycleName?: string | null;
} | null | undefined;

export function billingCycleLabel(cycle: BillingCycleLabelSource, fallback = "—") {
  const code = String(cycle?.cycleCode ?? "").trim();
  const name = String(cycle?.cycleName ?? "").trim();
  if (code && name && code.toLocaleLowerCase() !== name.toLocaleLowerCase()) {
    return `${code} · ${name}`;
  }
  return code || name || fallback;
}

