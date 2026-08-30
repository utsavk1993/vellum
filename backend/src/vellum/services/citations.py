from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass

# The model wraps each supporting quote in <cite doc="..." page="N">verbatim text</cite>.
# The tag never reaches the reader: the parser strips it, leaves a plain [N] marker in
# the prose, and hands the quote off to be checked against the page it claims to come from.
_OPEN = "<cite"
_CLOSE = "</cite>"

_ATTR_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"')

# A quote counts as verified when this much of it appears as one contiguous run in the
# cited page. Below 1.0 because PDF extraction introduces ligatures, soft hyphens, and
# line-break artefacts that no amount of normalisation fully removes.
MATCH_THRESHOLD = 0.85

# Quotes shorter than this are too weak to be evidence of anything — "the Tenant" would
# match almost any page of a lease — so they are rejected rather than trivially verified.
MIN_QUOTE_CHARS = 12


@dataclass(frozen=True)
class RawCitation:
    """A citation as the model emitted it, before it has been checked."""

    ordinal: int
    document_id: str
    page_number: int
    quote: str


def normalise(text: str) -> str:
    """Reduce text to a form where extraction noise no longer defeats comparison.

    Collapses whitespace, folds Unicode punctuation to ASCII, rejoins words split
    across a line break by a hyphen, and lowercases. Deliberately lossy — the goal
    is to decide whether two strings say the same thing, not to round-trip them.
    """
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("­", "")  # soft hyphen
    text = re.sub(r"-\s*\n\s*", "", text)  # hyphenation across a line break
    text = text.translate(
        str.maketrans(
            {
                "‘": "'",
                "’": "'",
                "“": '"',
                "”": '"',
                "–": "-",
                "—": "-",
                "−": "-",
                " ": " ",
            }
        )
    )
    return re.sub(r"\s+", " ", text).strip().lower()


def quote_matches(quote: str, page_text: str) -> bool:
    """True when `quote` genuinely appears in `page_text`.

    Exact containment after normalisation is the common case. The fuzzy branch exists
    for quotes the PDF layer mangled: it asks whether at least MATCH_THRESHOLD of the
    quote survives as a single contiguous run, which tolerates dropped ligatures without
    accepting a quote that was merely assembled from scattered words on the page.
    """
    normalised_quote = normalise(quote)
    if len(normalised_quote) < MIN_QUOTE_CHARS:
        return False

    normalised_page = normalise(page_text)
    if normalised_quote in normalised_page:
        return True

    matcher = difflib.SequenceMatcher(None, normalised_quote, normalised_page, autojunk=False)
    match = matcher.find_longest_match(0, len(normalised_quote), 0, len(normalised_page))
    return match.size / len(normalised_quote) >= MATCH_THRESHOLD


def _partial_open_len(buffer: str) -> int:
    """Length of the trailing run of `buffer` that could still become a `<cite` tag."""
    for size in range(min(len(_OPEN) - 1, len(buffer)), 0, -1):
        if buffer.endswith(_OPEN[:size]):
            return size
    return 0


class CitationStreamParser:
    """Splits a streaming model response into visible text and citation records.

    Feeding is incremental and boundary-safe: a `<cite ...>` tag split across two chunks
    is held back rather than leaked to the reader half-rendered. Text is emitted as soon
    as it is provably not part of a pending tag, so streaming stays smooth.
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._attrs: dict[str, str] | None = None
        self._ordinal = 0

    def feed(self, chunk: str) -> list[tuple[str, object]]:
        """Consume a chunk, returning ("text", str) and ("citation", RawCitation) events."""
        self._buffer += chunk
        return self._drain(final=False)

    def flush(self) -> list[tuple[str, object]]:
        """Drain whatever remains once the model has stopped producing tokens."""
        return self._drain(final=True)

    def _drain(self, final: bool) -> list[tuple[str, object]]:
        events: list[tuple[str, object]] = []

        while True:
            if self._attrs is None:
                start = self._buffer.find(_OPEN)
                if start == -1:
                    # Hold back only a trailing fragment that might still open a tag.
                    hold = 0 if final else _partial_open_len(self._buffer)
                    text, self._buffer = (
                        self._buffer[: len(self._buffer) - hold],
                        self._buffer[len(self._buffer) - hold :],
                    )
                    if text:
                        events.append(("text", text))
                    return events

                if start:
                    events.append(("text", self._buffer[:start]))
                    self._buffer = self._buffer[start:]

                close_bracket = self._buffer.find(">")
                if close_bracket == -1:
                    if final:
                        # Truncated mid-tag: show the fragment rather than swallow it.
                        events.append(("text", self._buffer))
                        self._buffer = ""
                    return events

                self._attrs = dict(_ATTR_RE.findall(self._buffer[: close_bracket + 1]))
                self._buffer = self._buffer[close_bracket + 1 :]
                continue

            end = self._buffer.find(_CLOSE)
            if end == -1:
                if final:
                    # Unterminated quote — surface the text instead of losing it, but
                    # do not record a citation we never saw the end of.
                    events.append(("text", self._buffer))
                    self._buffer = ""
                    self._attrs = None
                return events

            quote, self._buffer = self._buffer[:end], self._buffer[end + len(_CLOSE) :]
            attrs, self._attrs = self._attrs, None

            document_id = attrs.get("doc", "").strip()
            page_raw = attrs.get("page", "").strip()
            if not document_id or not page_raw.isdigit():
                # Malformed tag: keep the quote readable, drop the broken citation.
                events.append(("text", quote))
                continue

            self._ordinal += 1
            events.append(("text", f"[{self._ordinal}]"))
            events.append(
                (
                    "citation",
                    RawCitation(
                        ordinal=self._ordinal,
                        document_id=document_id,
                        page_number=int(page_raw),
                        quote=quote.strip(),
                    ),
                )
            )
