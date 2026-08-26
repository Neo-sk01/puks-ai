"""One-off: turn the Questions tab of docs/acceptance-questions.html into
docs/acceptance-questions.json. Kept for reference; the JSON is now edited
by hand and is the source of truth."""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "docs" / "acceptance-questions.html"
OUT = ROOT / "docs" / "acceptance-questions.json"

# Scripted turns for the follow-up group — the sheet phrases these as
# instructions ("Ask R1, then: …"), so the runner has always carried them.
SCRIPTED = {
    "C1": ["How do I create a receipt header in Speed WMS?", "and which of those fields can I change?"],
    "C2": ["What does the STK_DAT table hold and what is its primary key?", "what about its foreign keys?"],
    "C3": ["how to close a grn"],
    "C4": ["stk_dat vs mvt_dat"],
    "C5": ["and which of those fields can I change?"],
}
REFUSE = {"N1", "N2", "N3", "N4"}


def md(fragment: str) -> str:
    """The sheet's must-contain HTML → markdown: <b>→**, <code>→`, strip the rest."""
    s = re.sub(r"<b>(.*?)</b>", r"**\1**", fragment, flags=re.S)
    s = re.sub(r"<code>(.*?)</code>", r"`\1`", s, flags=re.S)
    s = re.sub(r"<i>(.*?)</i>", r"*\1*", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def main() -> None:
    page = SHEET.read_text(encoding="utf-8").split("<!-- RESULTS:START -->")[0]
    out: list[dict] = []
    for section in re.findall(r"<section>(.*?)</section>", page, re.S):
        head = re.search(r'<h2>(.*?)</h2><span class="tag"[^>]*>(\w)</span>(?:<span class="why">(.*?)</span>)?', section, re.S)
        title, key, note = text(head.group(1)), head.group(2), text(head.group(3) or "")
        for row in re.finditer(r'<div class="q[^"]*" data-id="([A-Z]\d+)">.*?<p class="ask">(.*?)</p>(.*?)</div><div class="res">', section, re.S):
            qid, ask, rest = row.group(1), row.group(2), row.group(3)
            expect = re.search(r'<p class="expect">(.*?)</p>', rest, re.S)
            src = re.search(r'<span class="src">(.*?)</span>\s*$', rest.strip(), re.S)
            question = text(ask)
            out.append({
                "id": qid, "group": key, "group_title": title, "group_note": note,
                "question": question,
                "asked": SCRIPTED.get(qid, [question]),
                "must_contain": md(expect.group(1)) if expect else "",
                "source": text(src.group(1)).removeprefix("Source: ") if src else "",
                "kind": "refuse" if qid in REFUSE else "answer",
            })
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(out)} questions to {OUT}")


if __name__ == "__main__":
    main()
