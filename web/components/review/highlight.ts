/**
 * DOM helpers for inline highlights. Annotations are stored as (segment,
 * quote, occurrence) rather than DOM offsets, so they survive re-renders and
 * markdown changes; these functions turn that back into <mark> elements.
 *
 * React renders the segment content; these helpers mutate *inside* that
 * rendered subtree by splitting text nodes and wrapping them. That's safe
 * only because the subtree is memoised on the record id and never
 * re-rendered while a record is open — see RecordView.
 */

export function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

/** Locate the `occ`-th occurrence of `quote` in the concatenated text of
 *  `container`, as a Range spanning whatever element boundaries it crosses. */
export function findRange(container: Element, quote: string, occ: number): Range | null {
  const nodes = textNodes(container);
  let full = "";
  const map: { n: Text; start: number }[] = [];
  for (const n of nodes) { map.push({ n, start: full.length }); full += n.nodeValue ?? ""; }
  let idx = -1, from = 0;
  for (let k = 0; k <= occ; k++) {
    idx = full.indexOf(quote, from);
    if (idx < 0) return null;
    from = idx + 1;
  }
  const end = idx + quote.length;
  const locate = (pos: number, isEnd: boolean): [Text, number] => {
    for (let i = map.length - 1; i >= 0; i--) {
      const m = map[i];
      if (pos > m.start || (pos === m.start && (!isEnd || i === 0))) return [m.n, pos - m.start];
    }
    return [map[0].n, 0];
  };
  const [sn, so] = locate(idx, false);
  const [en, eo] = locate(end, true);
  const range = document.createRange();
  range.setStart(sn, so);
  range.setEnd(en, eo);
  return range;
}

/** Wrap every text node the range touches in its own <mark>. One annotation
 *  can therefore produce several marks (a quote across a list boundary, say);
 *  they all carry the same data-ann id. */
export function wrapRange(range: Range, className: string, dataset: Record<string, string> = {}): HTMLElement[] {
  const rootNode = range.commonAncestorContainer;
  const root = rootNode.nodeType === Node.TEXT_NODE ? rootNode.parentNode! : rootNode;
  const marks: HTMLElement[] = [];
  for (const n of textNodes(root).filter((t) => range.intersectsNode(t))) {
    const s = n === range.startContainer ? range.startOffset : 0;
    const e = n === range.endContainer ? range.endOffset : (n.nodeValue?.length ?? 0);
    if (e <= s) continue;
    const mid = n.splitText(s);
    mid.splitText(e - s);
    const mark = document.createElement("mark");
    mark.className = className;
    for (const [k, v] of Object.entries(dataset)) mark.dataset[k] = v;
    mid.parentNode!.insertBefore(mark, mid);
    mark.append(mid);
    marks.push(mark);
  }
  return marks;
}

/** Remove marks matching `selector` under `root`, putting their text back and
 *  merging adjacent text nodes so a later findRange sees clean text. */
export function unwrap(root: Element, selector: string): void {
  for (const m of Array.from(root.querySelectorAll(selector))) {
    const p = m.parentNode;
    if (!p) continue;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    p.normalize();
  }
}

/** How many times `quote` occurs in the segment before the selection starts —
 *  the occurrence index stored with the annotation. */
export function occurrenceBefore(segment: Element, range: Range, quote: string): number {
  const pre = document.createRange();
  pre.selectNodeContents(segment);
  pre.setEnd(range.startContainer, range.startOffset);
  const text = pre.toString();
  let occ = 0, p = -1;
  while ((p = text.indexOf(quote, p + 1)) >= 0) occ++;
  return occ;
}
