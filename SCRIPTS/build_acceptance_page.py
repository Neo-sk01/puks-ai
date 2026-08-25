"""Inject docs/acceptance-results.json into docs/acceptance-questions.html as a
Results tab. Idempotent: replaces whatever sits between the RESULTS markers."""
import html, json, re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "docs" / "acceptance-questions.html"
RESULTS = ROOT / "docs" / "acceptance-results.json"
REFUSAL = "I do not have enough information to answer this."
BULLET = re.compile(r"^\s*[-•*]\s+")
NUMBERED = re.compile(r"^\s*\d+[.)]\s+")
BLOCK_START = re.compile(r"^(\s*[-•*]\s+|\s*\d+[.)]\s+|#{1,4}\s|```)")


def md(text: str) -> str:
    """Tiny markdown → HTML: headings, bullets, numbered lists, code fences,
    inline code/bold, paragraphs. Enough for model answers, no more."""
    out, lines, i = [], text.split("\n"), 0
    def inline(s):
        s = html.escape(s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
        return s
    while i < len(lines):
        l = lines[i]
        if l.startswith("```"):
            j = i + 1; buf = []
            while j < len(lines) and not lines[j].startswith("```"): buf.append(lines[j]); j += 1
            out.append("<pre>" + html.escape("\n".join(buf)) + "</pre>"); i = j + 1; continue
        m = re.match(r"^(#{1,4})\s+(.*)", l)
        if m: out.append(f"<h4>{inline(m.group(2))}</h4>"); i += 1; continue
        if BULLET.match(l):
            out.append("<ul>")
            while i < len(lines) and BULLET.match(lines[i]):
                depth = (len(lines[i]) - len(lines[i].lstrip())) // 2
                item = inline(BULLET.sub("", lines[i]))
                out.append(f'<li style="margin-left:{depth}em">{item}</li>'); i += 1
            out.append("</ul>"); continue
        if NUMBERED.match(l):
            out.append("<ol>")
            while i < len(lines) and NUMBERED.match(lines[i]):
                item = inline(NUMBERED.sub("", lines[i]))
                out.append(f"<li>{item}</li>"); i += 1
            out.append("</ol>"); continue
        if l.strip() == "": i += 1; continue
        buf = []
        while i < len(lines) and lines[i].strip() and not BLOCK_START.match(lines[i]):
            buf.append(lines[i]); i += 1
        out.append("<p>" + inline(" ".join(buf)) + "</p>")
    return "\n".join(out)


def build(results: list[dict]) -> str:
    groups: dict[str, list[dict]] = {}
    for r in results: groups.setdefault(r["id"][0], []).append(r)
    names = {"R": "Receiving goods", "O": "Order preparation", "L": "Loading & shipping",
             "S": "Replenishment, storage & stock", "M": "Sampling, manufacturing & packaging",
             "G": "General settings & concepts", "D": "Database tables & SQL",
             "T": "Support procedures & tickets", "X": "L'Oréal specifications",
             "C": "Follow-ups & phrasing", "N": "Should refuse"}
    gated = sum(r["refused"] for r in results)
    model_refused = sum((not r["refused"]) and r["answer"].startswith(REFUSAL) for r in results)
    total_s = sum(r["elapsed_s"] for r in results)
    confs = [r["confidence"] for r in results if r["confidence"] is not None]
    parts = [f'''<div class="run-meta">
  <span><b>{len(results)}</b> questions run</span>
  <span><b>{gated}</b> gated refusals (&lt; 0.30)</span>
  <span><b>{model_refused}</b> model-side refusals</span>
  <span>median relevance <b>{sorted(confs)[len(confs)//2]:.2f}</b></span>
  <span>total <b>{total_s/60:.1f} min</b>, median <b>{sorted(r["elapsed_s"] for r in results)[len(results)//2]:.1f}s</b></span>
  <span>run {date.today().isoformat()}</span>
</div>''']
    for key in "ROLSMGDTXCN":
        if key not in groups: continue
        parts.append(f'<section><div class="sec-head"><h2>{names[key]}</h2><span class="tag">{key}</span></div>')
        for r in groups[key]:
            kind = ("refused" if r["refused"] else "model-refused" if r["answer"].startswith(REFUSAL)
                    else "self" if r.get("reason") == "self_description" else "answered")
            badge = {"refused": "REFUSED", "model-refused": "MODEL REFUSED", "self": "SELF-DESCRIPTION", "answered": "ANSWERED"}[kind]
            conf = "—" if r["confidence"] is None else f'{r["confidence"]:.3f}'
            asked = "".join(f"<li>{html.escape(a)}</li>" for a in r["asked"]) if len(r["asked"]) > 1 or r["asked"][0] != r["question"] else ""
            srcs = " · ".join(html.escape(str(s)) for s in r["sources"][:5] if s)
            body = md(r["answer"]) if r["answer"] else '<p class="refusal">I do not have enough information to answer this. Please contact support.</p>'
            parts.append(f'''<div class="q r-{kind}" data-id="{r["id"]}"><span class="id">{r["id"]}</span><div>
  <p class="ask">{html.escape(r["question"])}</p>
  {f'<ol class="asked">{asked}</ol>' if asked else ''}
  <div class="meta-row"><span class="badge">{badge}</span><span>relevance <b>{conf}</b></span><span>{r["elapsed_s"]}s</span><span class="src">top: <span>{html.escape(str(r["top_source"]))}</span></span></div>
  <div class="answer">{body}</div>
  {f'<p class="src">retrieved: <span>{srcs}</span></p>' if srcs else ''}
</div><div class="res"></div></div>''')
        parts.append("</section>")
    return "\n".join(parts)


s = SHEET.read_text()
results = json.loads(RESULTS.read_text())
block = f"<!-- RESULTS:START -->\n{build(results)}\n<!-- RESULTS:END -->"
if "<!-- RESULTS:START -->" in s:
    s = re.sub(r"<!-- RESULTS:START -->.*?<!-- RESULTS:END -->", lambda _: block, s, flags=re.S)
else:
    raise SystemExit("sheet has no RESULTS markers — add the tab scaffold first")
SHEET.write_text(s)
print(f"injected {len(results)} results into {SHEET}")
