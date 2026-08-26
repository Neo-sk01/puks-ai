"""Verdict store: one row per (question, tester); latest wins; summary math."""
import pytest

from api.acceptance_store import VERDICTS, Store, normalise_tester


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "acceptance.db")


def test_verdict_values_are_the_three_the_ui_offers():
    assert VERDICTS == ("pass", "partial", "fail")


@pytest.mark.parametrize("raw,key", [
    ("Neo", "neo"), ("  neo  ", "neo"), ("NEO  SEKALELI", "neo sekaleli"), ("Ñandú", "ñandú"),
])
def test_tester_key_is_trimmed_casefolded_and_single_spaced(raw, key):
    assert normalise_tester(raw) == key


def test_upsert_stores_and_returns_the_row(store):
    row = store.upsert("R1", "Neo", "pass", "clean")
    assert row["question_id"] == "R1" and row["tester"] == "neo" and row["tester_name"] == "Neo"
    assert row["verdict"] == "pass" and row["note"] == "clean" and row["updated_at"]


def test_a_later_verdict_replaces_the_earlier_one(store):
    store.upsert("R1", "Neo", "pass", "")
    store.upsert("R1", "neo ", "fail", "missed 060")          # same tester, different spelling
    mine = store.for_tester("NEO")
    assert list(mine) == ["R1"]
    assert mine["R1"]["verdict"] == "fail" and mine["R1"]["note"] == "missed 060"


def test_delete_removes_the_row_and_reports_whether_it_existed(store):
    store.upsert("R1", "Neo", "pass", "")
    assert store.delete("R1", "neo") is True
    assert store.delete("R1", "neo") is False
    assert store.for_tester("Neo") == {}


def test_summary_counts_testers_and_flags_disagreement(store):
    store.upsert("R1", "Neo", "pass", "")
    store.upsert("R1", "Thabo", "partial", "")
    store.upsert("R2", "Neo", "pass", "")
    store.upsert("R2", "Thabo", "pass", "")
    s = store.summary(["R1", "R2", "R3"])
    assert s["questions"]["R1"] == {"counts": {"pass": 1, "partial": 1, "fail": 0},
                                    "testers": ["Neo", "Thabo"], "disagreement": True}
    assert s["questions"]["R2"]["disagreement"] is False
    assert s["questions"]["R3"] == {"counts": {"pass": 0, "partial": 0, "fail": 0},
                                    "testers": [], "disagreement": False}
    assert s["totals"] == {"questions": 3, "scored": 2, "testers": 2, "pass_rate": 0.75}


def test_pass_rate_is_null_with_no_verdicts(store):
    assert store.summary(["R1"])["totals"]["pass_rate"] is None


def test_rejects_bad_verdicts_and_ids_at_the_store_boundary(store):
    with pytest.raises(ValueError):
        store.upsert("R1", "Neo", "maybe", "")
    with pytest.raises(ValueError):
        store.upsert("R1", "   ", "pass", "")


def test_survives_reopening_the_file(tmp_path):
    path = tmp_path / "acceptance.db"
    Store(path).upsert("R1", "Neo", "pass", "")
    assert Store(path).for_tester("Neo")["R1"]["verdict"] == "pass"


def test_summary_scopes_testers_to_given_question_ids(store):
    store.upsert("R1", "Neo", "pass", "")
    store.upsert("R1", "Thabo", "partial", "")
    store.upsert("Z9", "Alice", "fail", "")
    s = store.summary(["R1"])
    assert s["questions"] == {"R1": {"counts": {"pass": 1, "partial": 1, "fail": 0},
                                     "testers": ["Neo", "Thabo"], "disagreement": True}}
    assert s["totals"] == {"questions": 1, "scored": 1, "testers": 2, "pass_rate": 0.5}
