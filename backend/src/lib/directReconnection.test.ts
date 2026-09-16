import assert from "node:assert/strict";
import test from "node:test";
import { isAccountLedgerReconnectionSettlement } from "./directReconnection";

test("direct reconnection accepts current account-ledger settlement notes", () => {
  assert.equal(isAccountLedgerReconnectionSettlement(
    "Reconnection fee settled through account ledger balance after debit adjustment 17",
  ), true);
});

test("direct reconnection remains compatible with legacy account-balance settlement notes", () => {
  assert.equal(isAccountLedgerReconnectionSettlement(
    "Reconnection fee settled through account balance after debit adjustment 17",
  ), true);
  assert.equal(isAccountLedgerReconnectionSettlement("Awaiting payment"), false);
  assert.equal(isAccountLedgerReconnectionSettlement(null), false);
});
