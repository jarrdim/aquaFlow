import Hashids from "hashids";

const h = new Hashids("aquaflow_salt_2024", 6);

export function encodeId(id: number | bigint | string): string {
  const n = typeof id === "string" ? parseInt(id, 10) : Number(id);
  return h.encode(n);
}

export function decodeId(hash: string): number {
  const decoded = h.decode(hash);
  return decoded.length > 0 ? Number(decoded[0]) : 0;
}
