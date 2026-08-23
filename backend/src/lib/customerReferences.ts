import { prisma } from "./prisma";

const CUSTOMER_NUMBER_PATTERN = /^CUST-\d{4}-(\d{5})$/i;

function sequenceSuffix(customerNumber: string) {
  return CUSTOMER_NUMBER_PATTERN.exec(customerNumber.trim())?.[1];
}

export async function resolveCustomerReferences(references: string[]) {
  const uniqueReferences = [...new Set(references.map((reference) => reference.trim()))];
  const exactCustomers = await prisma.customer.findMany({
    where: { customerNumber: { in: uniqueReferences } },
    select: { customerId: true, customerNumber: true },
  });
  const customerIds = new Map(exactCustomers.map((customer) => [customer.customerNumber, customer.customerId]));
  const canonicalNumbers = new Map(exactCustomers.map((customer) => [customer.customerNumber, customer.customerNumber]));
  const unresolved = uniqueReferences.filter((reference) => !customerIds.has(reference));
  const wantedSuffixes = new Set(unresolved.map(sequenceSuffix).filter((suffix): suffix is string => Boolean(suffix)));
  const ambiguousReferences = new Set<string>();

  if (wantedSuffixes.size) {
    // Customer-number years may differ between legacy exports. The final five
    // digits are the stable MajiWare account sequence, but fallback is allowed
    // only when that sequence identifies exactly one customer.
    const candidates = await prisma.customer.findMany({
      select: { customerId: true, customerNumber: true },
    });
    const candidatesBySuffix = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const suffix = sequenceSuffix(candidate.customerNumber);
      if (!suffix || !wantedSuffixes.has(suffix)) continue;
      const matches = candidatesBySuffix.get(suffix) ?? [];
      matches.push(candidate);
      candidatesBySuffix.set(suffix, matches);
    }

    for (const reference of unresolved) {
      const suffix = sequenceSuffix(reference);
      if (!suffix) continue;
      const matches = candidatesBySuffix.get(suffix) ?? [];
      if (matches.length === 1) {
        customerIds.set(reference, matches[0].customerId);
        canonicalNumbers.set(reference, matches[0].customerNumber);
      } else if (matches.length > 1) {
        ambiguousReferences.add(reference);
      }
    }
  }

  return { customerIds, canonicalNumbers, ambiguousReferences };
}
