import { ReviewView } from "@/components/review/ReviewView";
import { readReview } from "@/lib/review-store";
import type { Annotation, GraphPoint, Patterns, ReviewRecord, Samples, Suggestion } from "@/lib/review";
import { getConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Error discovery over the acceptance set. Everything is read at request
 *  time — repo files locally, the bundled copies + Postgres on a standalone
 *  deploy (lib/review-store.ts). If prepare.py has never produced records
 *  the view explains that rather than rendering an empty queue. */
export default async function ReviewPage() {
  const [config, records, samples, annotations, suggestions, patterns, graph] = await Promise.all([
    getConfig(),
    readReview<ReviewRecord[]>("records"),
    readReview<Samples>("samples"),
    readReview<Annotation[]>("annotations"),
    readReview<Suggestion[]>("suggestions"),
    readReview<Patterns>("patterns"),
    readReview<GraphPoint[]>("graph"),
  ]);
  return (
    <ReviewView
      config={config}
      records={records}
      samples={samples}
      annotations={annotations}
      suggestions={suggestions}
      patterns={patterns}
      graph={graph}
    />
  );
}
