import assert from "node:assert/strict";
import test from "node:test";
import { isSystemGeneratedReplacementCycle, readingRequiresBill } from "./readingBilling";

test("routine and replacement-final readings require bills", () => {
  assert.equal(readingRequiresBill({ syncId: null }), true);
  assert.equal(readingRequiresBill({ syncId: "METER_REPLACEMENT:7" }), true);
  assert.equal(readingRequiresBill({ syncId: "MOBILE-READING-42" }), true);
});

test("meter replacement opening baselines do not require separate bills", () => {
  assert.equal(readingRequiresBill({ syncId: "METER_REPLACEMENT_BASELINE:7" }), false);
});

test("only the exact replacement-baseline prefix is exempt", () => {
  assert.equal(readingRequiresBill({ syncId: "METER_REPLACEMENT_BASELINE_WRONG:7" }), true);
});

test("direct replacement reading cycles are classified as system generated", () => {
  assert.equal(isSystemGeneratedReplacementCycle({ cycleCode: "MR-REP-15" }), true);
  assert.equal(isSystemGeneratedReplacementCycle({ cycleCode: "MR-BASE-15" }), true);
  assert.equal(isSystemGeneratedReplacementCycle({ cycleCode: "RC-2026-09" }), false);
  assert.equal(isSystemGeneratedReplacementCycle({ cycleCode: "MR-15" }), false);
});
