import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during SSR and the hydration pass, true afterwards. For UI that
 *  depends on browser-only state (the resolved theme) and would otherwise
 *  hydrate with a mismatch. useSyncExternalStore is the sanctioned way to
 *  read that split — no effect, no extra render-then-setState round trip. */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
