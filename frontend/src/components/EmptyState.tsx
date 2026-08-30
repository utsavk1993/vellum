import { FileSearch } from "lucide-react";
import { DocumentUpload } from "./DocumentUpload";

interface EmptyStateProps {
	onUpload: (files: File[]) => void;
	uploading?: boolean;
	documentCount: number;
}

const SUGGESTIONS = [
	"What are the break rights, and what conditions attach to them?",
	"Do the lease and the title report describe the same property?",
	"Flag anything that would concern a buyer at completion.",
];

export function EmptyState({
	onUpload,
	uploading,
	documentCount,
}: EmptyStateProps) {
	// Documents are indexed but nothing has been asked yet — prompt the question
	// rather than the upload.
	if (documentCount > 0) {
		return (
			<div className="flex max-w-md flex-col items-center px-4 text-center">
				<div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900">
					<FileSearch className="h-6 w-6 text-white" />
				</div>
				<h2 className="mb-1.5 text-lg font-semibold text-neutral-800">
					{documentCount} document{documentCount === 1 ? "" : "s"} ready
				</h2>
				<p className="mb-6 text-sm text-neutral-500">
					Ask anything about them. Every factual claim comes back with the
					clause it rests on, checked against the source.
				</p>
				<ul className="w-full space-y-1.5 text-left">
					{SUGGESTIONS.map((suggestion) => (
						<li
							key={suggestion}
							className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-500"
						>
							{suggestion}
						</li>
					))}
				</ul>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center px-4">
			<div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900">
				<FileSearch className="h-6 w-6 text-white" />
			</div>
			<h2 className="mb-1.5 text-lg font-semibold text-neutral-800">
				Start with the documents
			</h2>
			<p className="mb-7 max-w-sm text-center text-sm text-neutral-500">
				Add every document for the matter — leases, title reports, environmental
				assessments. Answers cite across all of them.
			</p>
			<DocumentUpload onUpload={onUpload} uploading={uploading} />
		</div>
	);
}
