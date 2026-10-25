type CycleRow = Record<string, any>;

export type CycleIdentity = {
  code: string;
  name: string;
  sequence: number;
};

/**
 * Returns the next yearly code and the next available name in a period group.
 * For example, RC-2026-65 becomes RC-2026-66, while a second October cycle is
 * named October 2026 (2).
 */
export function nextCycleIdentity(
  kind: "reading" | "billing",
  group: CycleRow | undefined,
  cycles: CycleRow[],
): CycleIdentity {
  if (!group) return { code: "", name: "", sequence: 1 };

  const prefix = kind === "reading" ? "RC" : "BC";
  const periodStart = String(group.periodStart ?? "").slice(0, 10);
  const groupCode = String(group.groupCode ?? "");
  const year = periodStart.slice(0, 4) || groupCode.match(/(\d{4})/)?.[1] || String(new Date().getFullYear());
  const startingSequence = Number(periodStart.slice(5, 7)) || 1;
  const codePattern = new RegExp(`^${prefix}-${year}-(\\d+)$`, "i");
  const usedSequences = cycles
    .map((cycle) => String(cycle.cycleCode ?? "").match(codePattern))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const codeSequence = usedSequences.length
    ? Math.max(...usedSequences) + 1
    : startingSequence;
  const code = `${prefix}-${year}-${String(codeSequence).padStart(2, "0")}`;

  const groupId = String(group.billingPeriodGroupId ?? "");
  const groupCycles = cycles.filter(
    (cycle) => String(cycle.billingPeriodGroupId ?? "") === groupId,
  );
  const baseName = String(group.groupName ?? "").trim() || `${year}-${String(startingSequence).padStart(2, "0")}`;
  const usedNames = new Set(groupCycles.map((cycle) => String(cycle.cycleName ?? "").toLocaleLowerCase()));
  let sequence = 1;
  while (usedNames.has((sequence === 1 ? baseName : `${baseName} (${sequence})`).toLocaleLowerCase())) {
    sequence += 1;
  }

  return {
    code,
    name: sequence === 1 ? baseName : `${baseName} (${sequence})`,
    sequence,
  };
}
