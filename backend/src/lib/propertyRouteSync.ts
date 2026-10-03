export type LinkedAccountRouteSync = {
  previousRouteId: bigint;
  nextRouteId: bigint | null;
};

/**
 * Accounts may explicitly override their property's meter-reading route.
 * Only move accounts that still carry the property's previous route; a
 * different explicit route is an intentional override, while a null route
 * already inherits the property route.
 */
export function linkedAccountRouteSync(
  previousRouteId: bigint | null,
  nextRouteId: bigint | null,
): LinkedAccountRouteSync | null {
  if (previousRouteId === null || previousRouteId === nextRouteId) return null;
  return { previousRouteId, nextRouteId };
}
