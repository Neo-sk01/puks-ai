import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison, so a wrong guess at /api/unlock can't be
 * narrowed down character-by-character via response-time measurement — the
 * classic timing side-channel a naive `a === b` is open to. Node's crypto
 * module has this built in (timingSafeEqual), but it throws on unequal
 * buffer lengths, so unequal lengths are rejected up front instead — that
 * branch is length-dependent in timing, but a length mismatch is already a
 * guaranteed miss, so it leaks nothing about the code's actual content.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
