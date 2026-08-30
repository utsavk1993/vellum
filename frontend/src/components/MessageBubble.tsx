import { AlertTriangle, Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import type { Citation, Document, Message } from "../types";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Href scheme used to make an inline marker clickable without leaving markdown. */
const CITE_HREF = "#citation-";

/**
 * Turn the `[n]` markers the server left in the prose into markdown links.
 *
 * Rendering citations inline — rather than only as chips underneath — means the
 * evidence sits next to the claim it supports, which is how a lawyer reads a cited
 * document. Doing it as a link keeps the markdown intact: the alternative, splitting
 * the text and rendering fragments, breaks any block the marker happens to sit inside
 * (tables and lists especially). The rendered anchor is styled into a superscript chip
 * and opens the reader panel at the page it cites.
 *
 * Only markers with a matching citation are converted, so a literal `[2015]` in a case
 * reference stays plain text.
 */
function linkCitations(content: string, citations: Citation[]): string {
	if (citations.length === 0) return content;
	const known = new Set(citations.map((c) => c.ordinal));
	return content.replace(/\[(\d{1,3})\]/g, (match, digits: string) => {
		const ordinal = Number(digits);
		return known.has(ordinal) ? `[${ordinal}](${CITE_HREF}${ordinal})` : match;
	});
}

/** Filename for a document id, so a page number is never shown without its document. */
function filenameOf(documents: Document[], documentId: string): string {
	return documents.find((doc) => doc.id === documentId)?.filename ?? "document";
}

interface CitationSummaryProps {
	citations: Citation[];
	documents: Document[];
	onCitationClick: (citation: Citation) => void;
}

/**
 * A one-line verification summary, with the full source list behind a click.
 *
 * The inline markers already carry each source, so listing every chip again underneath
 * is mostly duplication — and on a long answer the list grows taller than the answer.
 * What the list carries that the markers do not is the *aggregate*: whether anything
 * failed verification, without hovering markers one at a time. That is the claim this
 * product actually makes, so it stays — as a line rather than a wall.
 */
function CitationSummary({
	citations,
	documents,
	onCitationClick,
}: CitationSummaryProps) {
	const [expanded, setExpanded] = useState(false);
	if (citations.length === 0) return null;

	const verified = citations.filter((c) => c.verified).length;
	const allVerified = verified === citations.length;

	return (
		<div className="mt-3.5 border-t border-neutral-200 pt-2.5">
			<button
				type="button"
				onClick={() => setExpanded((open) => !open)}
				className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
					allVerified
						? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400"
						: "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500"
				}`}
			>
				{allVerified ? (
					<Check className="h-3.5 w-3.5" />
				) : (
					<AlertTriangle className="h-3.5 w-3.5" />
				)}
				<span>
					{allVerified
						? `All ${citations.length} source${citations.length === 1 ? "" : "s"} verified against the documents`
						: `${citations.length - verified} of ${citations.length} sources could not be verified`}
				</span>
				<ChevronDown
					className={`h-3 w-3 opacity-60 transition-transform ${expanded ? "rotate-180" : ""}`}
				/>
			</button>

			{expanded && (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{citations.map((citation) => (
						<button
							key={citation.ordinal}
							type="button"
							onClick={() => onCitationClick(citation)}
							aria-label={`Source ${citation.ordinal}, ${filenameOf(
								documents,
								citation.document_id,
							)} page ${citation.page_number} — ${
								citation.verified ? "verified" : "could not be verified"
							}`}
							className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
								citation.verified
									? "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
									: "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500"
							}`}
						>
							<span
								className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold tabular-nums text-white ${
									citation.verified ? "bg-emerald-700" : "bg-amber-700"
								}`}
							>
								{citation.ordinal}
							</span>
							<span className="truncate">
								{filenameOf(documents, citation.document_id)}
							</span>
							<span className="flex-shrink-0 font-mono text-neutral-400">
								p.{citation.page_number}
							</span>
							{/* The outcome, as a shape and not only a colour: which sources
							    failed is the reason to open this list at all, and a tinted
							    border alone is invisible to anyone who cannot separate the
							    two hues. */}
							{citation.verified ? (
								<Check
									className="h-3.5 w-3.5 flex-shrink-0 text-emerald-700"
									aria-label="Verified"
								/>
							) : (
								<AlertTriangle
									className="h-3.5 w-3.5 flex-shrink-0 text-amber-700"
									aria-label="Could not be verified"
								/>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

interface AnswerBodyProps {
	content: string;
	citations: Citation[];
	documents: Document[];
	streaming?: boolean;
	onCitationClick: (citation: Citation) => void;
}

/** Markdown answer with inline citation markers. */
function AnswerBody({
	content,
	citations,
	documents,
	streaming,
	onCitationClick,
}: AnswerBodyProps) {
	const linked = useMemo(
		() => linkCitations(content, citations),
		[content, citations],
	);

	// Override Streamdown's anchor rather than styling one. Its `linkSafety` default
	// renders links as buttons behind a "you are leaving this page" modal, which is
	// right for model-authored external URLs and wrong for a marker that points at a
	// page of the document already open. Supplying the component sidesteps that
	// entirely and gives a marker with a hover tooltip.
	const components = useMemo(
		() => ({
			a: ({
				href,
				children,
				...props
			}: {
				href?: string;
				children?: React.ReactNode;
			}) => {
				if (!href?.startsWith(CITE_HREF)) {
					return (
						<a href={href} rel="noreferrer" target="_blank" {...props}>
							{children}
						</a>
					);
				}
				const ordinal = Number(href.slice(CITE_HREF.length));
				const citation = citations.find((c) => c.ordinal === ordinal);
				if (!citation) return <>{children}</>;

				return (
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								data-citation={citation.verified ? "verified" : "unverified"}
								aria-label={`Source ${ordinal}: ${filenameOf(
									documents,
									citation.document_id,
								)}, page ${citation.page_number}`}
								onClick={() => onCitationClick(citation)}
							>
								{ordinal}
							</button>
						</TooltipTrigger>
						<TooltipContent side="top" className="max-w-md">
							<p className="mb-0.5 text-xs font-medium">
								{filenameOf(documents, citation.document_id)}
							</p>
							<p className="mb-1.5 text-[11px] opacity-80">
								{citation.verified
									? `Page ${citation.page_number} — click to open`
									: `Page ${citation.page_number} — could not be found on this page`}
							</p>
							<p className="text-xs italic leading-relaxed opacity-90">
								“{citation.quote}”
							</p>
						</TooltipContent>
					</Tooltip>
				);
			},
		}),
		[citations, documents, onCitationClick],
	);

	return (
		<div className="prose prose-sm max-w-none">
			<Streamdown
				mode={streaming ? "streaming" : undefined}
				components={components}
			>
				{linked}
			</Streamdown>
		</div>
	);
}

interface MessageBubbleProps {
	message: Message;
	documents: Document[];
	onCitationClick: (citation: Citation) => void;
}

export function MessageBubble({
	message,
	documents,
	onCitationClick,
}: MessageBubbleProps) {
	if (message.role === "user") {
		return (
			<div className="flex justify-end py-2">
				<div className="max-w-[75%] rounded-2xl rounded-br-md bg-neutral-900 px-4 py-2.5">
					<p className="whitespace-pre-wrap text-sm text-white">
						{message.content}
					</p>
				</div>
			</div>
		);
	}

	// An answer about documents that came back with nothing citable is worth saying out
	// loud. Silence would leave it looking like an ordinary, grounded answer.
	const uncited =
		documents.length > 0 &&
		message.citations.length === 0 &&
		message.content.trim().length > 0;

	return (
		<div className="py-2">
			<AnswerBody
				content={message.content}
				citations={message.citations}
				documents={documents}
				onCitationClick={onCitationClick}
			/>
			{uncited && (
				<p className="mt-2.5 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
					<span>
						No verifiable citations were returned for this answer. Treat it as
						unchecked and confirm against the documents before relying on it.
					</span>
				</p>
			)}
			<CitationSummary
				citations={message.citations}
				documents={documents}
				onCitationClick={onCitationClick}
			/>
		</div>
	);
}

interface StreamingBubbleProps {
	content: string;
	citations: Citation[];
	documents: Document[];
	onCitationClick: (citation: Citation) => void;
}

export function StreamingBubble({
	content,
	citations,
	documents,
	onCitationClick,
}: StreamingBubbleProps) {
	if (!content) return null;

	return (
		<div className="py-2">
			<AnswerBody
				content={content}
				citations={citations}
				documents={documents}
				streaming
				onCitationClick={onCitationClick}
			/>
		</div>
	);
}
