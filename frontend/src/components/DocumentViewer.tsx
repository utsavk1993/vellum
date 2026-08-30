import {
	AlertTriangle,
	ChevronLeft,
	ChevronRight,
	FileText,
	Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document as PDFDocument, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { getDocumentUrl } from "../lib/api";
import { findQuoteItems } from "../lib/highlight";
import type { Document, ViewerTarget } from "../types";
import { Button } from "./ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"pdfjs-dist/build/pdf.worker.min.mjs",
	import.meta.url,
).toString();

const MIN_WIDTH = 340;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 460;

/* The reader may take at most this share of the window. Fixed at 460px it squeezed the
   answer to under 300px on a 1024px screen — three panes all present and none of them
   usable. The reader yields first because the answer is what is being read. */
const MAX_VIEWPORT_SHARE = 0.4;

interface DocumentViewerProps {
	documents: Document[];
	target: ViewerTarget | null;
	onTargetChange: (target: ViewerTarget) => void;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function DocumentViewer({
	documents,
	target,
	onTargetChange,
}: DocumentViewerProps) {
	const [numPages, setNumPages] = useState(0);
	const [pdfError, setPdfError] = useState<string | null>(null);
	const [width, setWidth] = useState(DEFAULT_WIDTH);
	const [available, setAvailable] = useState(() =>
		typeof window === "undefined"
			? Number.POSITIVE_INFINITY
			: window.innerWidth,
	);
	const [dragging, setDragging] = useState(false);
	const pageRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onResize = () => setAvailable(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	// The dragged width is the reader's preference; this is what the window allows.
	const effectiveWidth = Math.max(
		MIN_WIDTH,
		Math.min(width, Math.round(available * MAX_VIEWPORT_SHARE)),
	);

	const active =
		documents.find((doc) => doc.id === target?.documentId) ??
		documents[0] ??
		null;
	const currentPage = target?.page ?? 1;

	// Keep the target pointing at a real document as uploads arrive or the
	// conversation changes underneath the panel.
	useEffect(() => {
		if (!active) return;
		if (target?.documentId !== active.id) {
			onTargetChange({ documentId: active.id, page: 1 });
		}
	}, [active, target?.documentId, onTargetChange]);

	const goToPage = useCallback(
		(page: number) => {
			if (!active) return;
			onTargetChange({ documentId: active.id, page });
		},
		[active, onTargetChange],
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setDragging(true);
			const startX = e.clientX;
			const startWidth = width;

			const onMove = (move: MouseEvent) => {
				setWidth(
					Math.min(
						MAX_WIDTH,
						Math.max(MIN_WIDTH, startWidth + (startX - move.clientX)),
					),
				);
			};
			const onUp = () => {
				setDragging(false);
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
			};
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[width],
	);

	/* The page's text layer, kept so that following a second citation onto a page that
	   is already open re-matches against it rather than re-rendering the page. It is
	   tagged with the page it came from: a quote must never be matched against the
	   previous page's text in the frame before the new one finishes rendering. */
	const pageKey = `${active?.id ?? ""}-${currentPage}`;
	const [layer, setLayer] = useState<{ key: string; items: { str: string }[] }>(
		{
			key: "",
			items: [],
		},
	);

	const handleTextLayer = useCallback(
		(content: { items: unknown[] }) => {
			const items = content.items as { str?: string }[];
			setLayer({
				key: pageKey,
				items: items.map((item) => ({ str: item.str ?? "" })),
			});
		},
		[pageKey],
	);

	// The items making up the quoted passage, resolved once per page from the whole
	// text layer rather than judged span by span — see lib/highlight.
	const quote = target?.quote;
	const quoteItems = useMemo(
		() =>
			quote && layer.key === pageKey
				? findQuoteItems(layer.items, quote)
				: new Set<number>(),
		[layer, pageKey, quote],
	);

	const highlight = useCallback(
		(item: { str: string; itemIndex: number }) => {
			const text = escapeHtml(item.str);
			if (!quoteItems.has(item.itemIndex)) return text;
			return `<mark class="citation-highlight">${text}</mark>`;
		},
		[quoteItems],
	);

	// Bring the highlighted passage into view once the text layer has rendered.
	useEffect(() => {
		if (quoteItems.size === 0) return;
		const timer = window.setTimeout(() => {
			pageRef.current
				?.querySelector(".citation-highlight")
				?.scrollIntoView({ block: "center", behavior: "smooth" });
		}, 180);
		return () => window.clearTimeout(timer);
	}, [quoteItems]);

	if (documents.length === 0) {
		return (
			<aside
				style={{ width }}
				className="relative z-10 flex h-full flex-shrink-0 flex-col items-center justify-center border-l border-neutral-200 bg-neutral-50/60"
			>
				<FileText className="mb-3 h-9 w-9 text-neutral-300" />
				<p className="text-sm text-neutral-400">No documents yet</p>
				<p className="mt-1 max-w-[15rem] text-center text-xs text-neutral-400">
					Upload the lease, title report and any surveys — answers can cite
					across all of them.
				</p>
			</aside>
		);
	}

	return (
		<aside
			style={{ width: effectiveWidth }}
			className="relative z-10 flex h-full flex-shrink-0 flex-col border-l border-neutral-200 bg-white"
		>
			<button
				type="button"
				aria-label="Resize document panel"
				className={`absolute top-0 left-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-neutral-300 ${
					dragging ? "bg-neutral-400" : "bg-transparent"
				}`}
				onMouseDown={handleMouseDown}
			/>

			<div className="border-b border-neutral-100 px-4 py-3">
				<div className="flex items-center gap-2">
					<FileText className="h-4 w-4 flex-shrink-0 text-neutral-400" />
					{documents.length === 1 ? (
						<p className="truncate text-sm font-medium text-neutral-800">
							{active?.filename}
						</p>
					) : (
						<select
							value={active?.id ?? ""}
							onChange={(e) =>
								onTargetChange({ documentId: e.target.value, page: 1 })
							}
							className="min-w-0 flex-1 cursor-pointer truncate rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm font-medium text-neutral-800 outline-none transition-colors hover:border-neutral-300 focus:border-neutral-400"
						>
							{documents.map((doc) => (
								<option key={doc.id} value={doc.id}>
									{doc.filename}
								</option>
							))}
						</select>
					)}
				</div>
				<div className="mt-1 flex items-center gap-2 pl-6">
					<p className="text-xs text-neutral-400">
						{active?.page_count} page{active?.page_count === 1 ? "" : "s"}
						{documents.length > 1 ? ` · ${documents.length} documents` : ""}
					</p>
					{active && !active.has_text && (
						<span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
							<AlertTriangle className="h-3 w-3" />
							No text layer
						</span>
					)}
				</div>
			</div>

			<div
				ref={pageRef}
				className="flex-1 overflow-y-auto bg-neutral-100/70 p-4"
			>
				{pdfError && (
					<div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
						{pdfError}
					</div>
				)}

				{active && (
					<PDFDocument
						key={active.id}
						file={getDocumentUrl(active.id)}
						onLoadSuccess={({ numPages: pages }) => {
							setNumPages(pages);
							setPdfError(null);
						}}
						onLoadError={(err) =>
							setPdfError(`Failed to load PDF: ${err.message}`)
						}
						loading={
							<div className="flex items-center justify-center py-16">
								<Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
							</div>
						}
					>
						<Page
							key={`${active.id}-${currentPage}-${effectiveWidth}`}
							pageNumber={Math.min(currentPage, numPages || currentPage)}
							width={width - 64}
							customTextRenderer={highlight}
							onGetTextSuccess={handleTextLayer}
							className="mx-auto overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-neutral-200"
							loading={
								<div className="flex items-center justify-center py-16">
									<Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
								</div>
							}
						/>
					</PDFDocument>
				)}
			</div>

			{numPages > 0 && (
				<div className="flex items-center justify-center gap-3 border-t border-neutral-100 px-4 py-2.5">
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						aria-label="Previous page"
						disabled={currentPage <= 1}
						onClick={() => goToPage(Math.max(1, currentPage - 1))}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<span className="tabular-nums text-xs text-neutral-500">
						Page {Math.min(currentPage, numPages)} of {numPages}
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						aria-label="Next page"
						disabled={currentPage >= numPages}
						onClick={() => goToPage(Math.min(numPages, currentPage + 1))}
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			)}
		</aside>
	);
}
