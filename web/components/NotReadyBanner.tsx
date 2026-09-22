import { TriangleAlert } from "lucide-react";
import type { Health } from "@/lib/types";

/** Replaces Streamlit's st.error(...) + st.stop() on ConfigError.
 *  The committed index is 384-dim against a 3072-dim requirement, so this
 *  is the state the app is actually in until build_index.py is run.
 *
 *  --color-hazard is one of its three sanctioned appearances here: the
 *  banner border, heading, icon and the raw ConfigError text. The fix
 *  instructions below are guidance, not the problem, so they stay in the
 *  muted-foreground colour rather than continuing the hazard tint. */
export function NotReadyBanner({ health }: { health: Health }) {
  if (health.ready) return null;
  return (
    <div
      role="alert"
      className="mx-auto w-full max-w-2xl animate-msg-in rounded-2xl border border-hazard/40 bg-hazard/10 p-6 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-hazard/15 text-hazard">
          <TriangleAlert className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold text-hazard">
            Not ready to answer questions
          </h2>
          <pre className="scroll-thin mt-3 overflow-x-auto rounded-lg bg-hazard/10 p-3 font-mono text-sm whitespace-pre-wrap text-hazard">
            {health.error}
          </pre>
          <p className="mt-3 text-sm text-muted-foreground">
            Set <code className="font-mono text-type">AZURE_AI_KEY</code> in{" "}
            <code className="font-mono text-type">.env</code>, then run{" "}
            <code className="font-mono text-type">python SCRIPTS/build_index.py</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
