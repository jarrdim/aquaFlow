import assert from "node:assert/strict";
import test from "node:test";
import { calculateReplacementBill } from "../routes/meters";

const tariff = {
  billingMethod: "UNIT_RATE",
  ratePerUnit: 10,
  flatAmount: 0,
  minimumCharge: 100,
  standingCharge: 0,
  meterRent: 0,
  bands: [],
};

test("replacement billing applies the tariff minimum by default", () => {
  const result = calculateReplacementBill(tariff, 0);

  assert.equal(result.consumptionCharge, 0);
  assert.equal(result.minimumChargeAdjustment, 100);
  assert.equal(result.totalCurrentCharges, 100);
  assert.equal(result.items.some((item) => item.chargeType === "MINIMUM_ADJUSTMENT"), true);
});

test("replacement billing can waive only the minimum adjustment", () => {
  const result = calculateReplacementBill(tariff, 0, false);

  assert.equal(result.consumptionCharge, 0);
  assert.equal(result.minimumChargeAdjustment, 0);
  assert.equal(result.totalCurrentCharges, 0);
  assert.equal(result.items.some((item) => item.chargeType === "MINIMUM_ADJUSTMENT"), false);
});

test("waiving the minimum does not waive actual consumption or fixed charges", () => {
  const result = calculateReplacementBill({ ...tariff, standingCharge: 25, meterRent: 15 }, 4, false);

  assert.equal(result.consumptionCharge, 40);
  assert.equal(result.minimumChargeAdjustment, 0);
  assert.equal(result.standingCharge, 25);
  assert.equal(result.meterRent, 15);
  assert.equal(result.totalCurrentCharges, 80);
});
