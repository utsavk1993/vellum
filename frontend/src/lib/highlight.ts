/** Locating a quoted passage inside a PDF's text layer. */

/** Punctuation the extractor and the model spell differently. */
const FOLD: Record<string, string> = {
	"‘": "'",
	"’": "'",
	"“": '"',
	"”": '"',
	"–": "-",
	"—": "-",
	"−": "-",
	" ": " ",
};

interface NormalisedText {
	text: string;
	/** For each character in `text`, the text-layer item it came from. */
	owners: number[];
}

/**
 * Fold a run of text-layer items into one comparable string, remembering which item
 * each surviving character came from.
 *
 * Normalising and matching have to happen together: collapsing whitespace changes the
 * length of the string, so a position found in the folded text cannot be mapped back to
 * the original without carrying the provenance along as we go.
 */
function normaliseItems(items: { str: string }[]): NormalisedText {
	const chars: string[] = [];
	const owners: number[] = [];
	let lastWasSpace = true; // leading whitespace is dropped

	items.forEach((item, index) => {
		for (const raw of item.str.normalize("NFKC")) {
			const folded = FOLD[raw] ?? raw;
			const isSpace = /\s/.test(folded);
			if (isSpace) {
				if (lastWasSpace) continue;
				chars.push(" ");
				owners.push(index);
				lastWasSpace = true;
				continue;
			}
			chars.push(folded.toLowerCase());
			owners.push(index);
			lastWasSpace = false;
		}
		// Items sit side by side on the page but carry no trailing space of their own,
		// so without this every item would run into the next one.
		if (!lastWasSpace) {
			chars.push(" ");
			owners.push(index);
			lastWasSpace = true;
		}
	});

	return { text: chars.join(""), owners };
}

function normaliseQuote(quote: string): string {
	let out = "";
	let lastWasSpace = true;
	for (const raw of quote.normalize("NFKC")) {
		const folded = FOLD[raw] ?? raw;
		if (/\s/.test(folded)) {
			if (!lastWasSpace) {
				out += " ";
				lastWasSpace = true;
			}
			continue;
		}
		out += folded.toLowerCase();
		lastWasSpace = false;
	}
	return out.trim();
}

interface Run {
	pageStart: number;
	length: number;
	/** How much of the quote this run accounts for. */
	quoteLength: number;
}

/** Anchor length used to find a foothold before growing a run outwards. */
const ANCHOR = 16;
/** Runs shorter than this are as likely to be a common phrase as the quoted passage. */
const MIN_RUN = 20;

/**
 * Every substantial run of the quote that appears on the page.
 *
 * A quote is contiguous in the source but rarely contiguous in the text layer: the
 * extractor inserts a header, a line number, or a hyphen the model did not reproduce,
 * so a 300-character passage typically survives as two or three long runs rather than
 * one. Insisting on a single run meant those quotes highlighted nothing at all.
 */
function matchingRuns(quote: string, page: string): Run[] {
	const runs: Run[] = [];
	let cursor = 0;

	while (cursor + ANCHOR <= quote.length) {
		const at = page.indexOf(quote.slice(cursor, cursor + ANCHOR));
		if (at === -1) {
			cursor += ANCHOR;
			continue;
		}

		// Grow the foothold in both directions for as long as the two agree.
		let from = cursor;
		let to = cursor + ANCHOR;
		let pageFrom = at;
		let pageTo = at + ANCHOR;
		while (from > 0 && pageFrom > 0 && quote[from - 1] === page[pageFrom - 1]) {
			from -= 1;
			pageFrom -= 1;
		}
		while (
			to < quote.length &&
			pageTo < page.length &&
			quote[to] === page[pageTo]
		) {
			to += 1;
			pageTo += 1;
		}

		const length = pageTo - pageFrom;
		if (length >= MIN_RUN) {
			runs.push({ pageStart: pageFrom, length, quoteLength: to - from });
		}
		// Continue past what this run consumed, so each part of the quote is
		// accounted for once.
		cursor = Math.max(to, cursor + ANCHOR);
	}

	return runs;
}

/** Fraction of the quote that must be accounted for before anything is highlighted. */
const MIN_COVERAGE = 0.5;

/**
 * Which text-layer items make up a quoted passage on this page.
 *
 * The earlier approach asked, of each item independently, "is this span contained in the
 * quote?" — which silently dropped every short one. A PDF text layer splits lines into
 * runs of one, six, twenty characters, so a 300-character quote lit up only its longest
 * few spans and appeared on screen as a handful of disconnected fragments.
 *
 * Matching by position instead marks the whole passage and nothing else: a one-character
 * item inside the run is included because of where it sits, and an identical word
 * elsewhere on the page is not.
 */
export function findQuoteItems(
	items: { str: string }[],
	quote: string,
): Set<number> {
	const found = new Set<number>();
	const needle = normaliseQuote(quote);
	if (!needle || items.length === 0) return found;

	const page = normaliseItems(items);

	const exact = page.text.indexOf(needle);
	const runs: Run[] =
		exact === -1
			? matchingRuns(needle, page.text)
			: [
					{
						pageStart: exact,
						length: needle.length,
						quoteLength: needle.length,
					},
				];

	const covered = runs.reduce((total, run) => total + run.quoteLength, 0);
	// Below this the "match" is more likely a common legal phrase appearing elsewhere
	// than the passage itself, and highlighting the wrong text is worse than none.
	if (covered < needle.length * MIN_COVERAGE) return found;

	for (const run of runs) {
		for (
			let index = run.pageStart;
			index < run.pageStart + run.length;
			index += 1
		) {
			const owner = page.owners[index];
			if (owner !== undefined) found.add(owner);
		}
	}
	return found;
}
