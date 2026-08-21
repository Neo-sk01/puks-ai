import type { Health } from "@/lib/types";

/** Replaces Streamlit's st.error(...) + st.stop() on ConfigError.
 *  The committed index is 384-dim against a 3072-dim requirement, so this
 *  is the state the app is actually in until build_index.py is run.
 *
 *  --color-hazard is one of its three sanctioned appearances here: the
 *  banner border, heading, and the raw ConfigError text. The fix
 *  instructions below are guidance, not the problem, so they stay in
 *  --color-muted rather than continuing the hazard tint. */
export function NotReadyBanner({ health }: { health: Health }) {
  if (health.ready) return null;
  return (
    <div role="alert" className="rounded-lg border border-hazard/40 bg-hazard/10 p-5">
      <h2 className="font-semibold text-hazard">Not ready to answer questions</h2>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-sm text-hazard/90">
        {health.error}
      </pre>
      <p className="mt-3 text-sm text-muted">
        Set <code className="font-mono text-type">AZURE_AI_KEY</code> in{" "}
        <code className="font-mono text-type">.env</code>, then run{" "}
        <code className="font-mono text-type">python SCRIPTS/build_index.py</code>.
      </p>
    </div>
  );
}
