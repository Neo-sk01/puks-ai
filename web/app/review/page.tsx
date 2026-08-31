import { ReviewView } from "@/components/review/ReviewView";
import { readReview } from "@/lib/review-store";
import type { Annotation, GraphPoint, Patterns, ReviewRecord, Samples, Suggestion } from "@/lib/review";
import { getConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Error discovery over the acceptance set. Everything is read from
 *  evals/error-discovery/data at request time; if prepare.py hasn't been
 *  run the view explains that rather than rendering an empty queue. */
export default async function ReviewPage() {
  const config = await getConfig();
  return (
    <ReviewView
      config={config}
      records={readReview<ReviewRecord[]>("records")}
      samples={readReview<Samples>("samples")}
      annotations={readReview<Annotation[]>("annotations")}
      suggestions={readReview<Suggestion[]>("suggestions")}
      patterns={readReview<Patterns>("patterns")}
      graph={readReview<GraphPoint[]>("graph")}
    />
  );
}
