export function isAccountLedgerReconnectionSettlement(note: unknown) {
  const value = String(note ?? "").toLowerCase();
  return value.includes("account ledger")
    || value.includes("account balance after debit adjustment");
}
