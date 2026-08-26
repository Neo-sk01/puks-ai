"""docs/acceptance-questions.json is the single source of truth for the
acceptance set. These pin its shape so the API, the runner and the HTML
export cannot drift apart."""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = ROOT / "docs" / "acceptance-questions.json"
GROUP_ORDER = list("ROLSMGDTXCN")


@pytest.fixture(scope="module")
def questions() -> list[dict]:
    return json.loads(QUESTIONS.read_text(encoding="utf-8"))


def test_there_are_sixty_five_questions_in_sheet_order(questions):
    assert len(questions) == 65
    ids = [q["id"] for q in questions]
    assert len(set(ids)) == 65
    groups_seen = [q["group"] for q in questions]
    # groups appear in the fixed order, each contiguous
    order = [g for i, g in enumerate(groups_seen) if i == 0 or g != groups_seen[i - 1]]
    assert order == GROUP_ORDER


def test_every_question_has_the_full_shape(questions):
    for q in questions:
        assert set(q) == {"id", "group", "group_title", "group_note", "question",
                          "asked", "must_contain", "source", "kind"}, q["id"]
        assert q["id"].startswith(q["group"])
        assert q["question"].strip()
        assert isinstance(q["asked"], list) and q["asked"]
        assert q["kind"] in ("answer", "refuse")


def test_scripted_follow_ups_carry_their_prior_turn(questions):
    by_id = {q["id"]: q for q in questions}
    assert by_id["C1"]["asked"] == [
        "How do I create a receipt header in Speed WMS?",
        "and which of those fields can I change?",
    ]
    assert by_id["C5"]["asked"] == ["and which of those fields can I change?"]
    assert by_id["R1"]["asked"] == [by_id["R1"]["question"]]


def test_refusal_group_is_marked_except_the_self_description(questions):
    by_id = {q["id"]: q for q in questions}
    assert {by_id[i]["kind"] for i in ("N1", "N2", "N3", "N4")} == {"refuse"}
    assert by_id["N5"]["kind"] == "answer"


def test_must_contain_is_markdown_not_html(questions):
    for q in questions:
        assert "<b>" not in q["must_contain"] and "<code>" not in q["must_contain"], q["id"]
