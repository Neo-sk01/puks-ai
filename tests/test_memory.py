"""format_memory must reproduce APPLICATION(STREAMLIT)/APP.py's ConversationMemory
byte-for-byte — it is part of the prompt, not a display concern."""
from collections import deque

from puks_rag import format_memory


class ReferenceMemory:
    """Verbatim copy of the Streamlit ConversationMemory, kept as the oracle."""

    def __init__(self, max_turns: int = 8):
        self.history = deque(maxlen=max_turns * 2)

    def add_turn(self, question: str, answer: str):
        self.history.append({"role": "user", "content": question})
        self.history.append({"role": "assistant", "content": answer})

    def format(self) -> str:
        if not self.history:
            return "(No prior conversation)"
        lines = []
        for m in self.history:
            role = "USER" if m["role"] == "user" else "ASSISTANT"
            content = m["content"]
            if m["role"] == "assistant" and len(content) > 400:
                content = content[:400] + "... [truncated]"
            lines.append(f"{role}: {content}")
        return "\n".join(lines)


def _both(turns: list[tuple[str, str]]) -> tuple[str, str]:
    reference = ReferenceMemory()
    history: list[dict] = []
    for question, reply in turns:
        reference.add_turn(question, reply)
        history.append({"role": "user", "content": question})
        history.append({"role": "assistant", "content": reply})
    return format_memory(history), reference.format()


def test_empty_history_is_the_exact_sentinel():
    assert format_memory([]) == "(No prior conversation)"


def test_single_turn_matches_reference():
    mine, reference = _both([("how do I reverse a GRN?", "Run the validate query first.")])
    assert mine == reference
    assert mine == "USER: how do I reverse a GRN?\nASSISTANT: Run the validate query first."


def test_long_assistant_reply_truncates_at_400():
    mine, reference = _both([("q", "x" * 500)])
    assert mine == reference
    assert mine == "USER: q\nASSISTANT: " + "x" * 400 + "... [truncated]"


def test_long_user_message_is_never_truncated():
    mine, reference = _both([("y" * 500, "short")])
    assert mine == reference
    assert "y" * 500 in mine


def test_reply_of_exactly_400_is_not_truncated():
    mine, reference = _both([("q", "z" * 400)])
    assert mine == reference
    assert "[truncated]" not in mine


def test_window_keeps_only_the_last_eight_turns():
    turns = [(f"q{i}", f"a{i}") for i in range(12)]
    mine, reference = _both(turns)
    assert mine == reference
    assert "q3" not in mine
    assert "q4" in mine
    assert len(mine.splitlines()) == 16
