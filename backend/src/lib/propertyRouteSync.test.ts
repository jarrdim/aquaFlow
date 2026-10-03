import assert from "node:assert/strict";
import test from "node:test";
import { linkedAccountRouteSync } from "./propertyRouteSync";

test("moves linked accounts from the property's previous route to its new route", () => {
  assert.deepEqual(linkedAccountRouteSync(2n, 4n), {
    previousRouteId: 2n,
    nextRouteId: 4n,
  });
});

test("clears the inherited account route when the property route is removed", () => {
  assert.deepEqual(linkedAccountRouteSync(2n, null), {
    previousRouteId: 2n,
    nextRouteId: null,
  });
});

test("does not write account routes when no synchronization is required", () => {
  assert.equal(linkedAccountRouteSync(2n, 2n), null);
  assert.equal(linkedAccountRouteSync(null, 4n), null);
});
