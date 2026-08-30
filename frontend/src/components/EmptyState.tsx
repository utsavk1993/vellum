import { FileSearch } from "lucide-react";
import { DocumentUpload } from "./DocumentUpload";

interface EmptyStateProps {
	onUpload: (file: File) => void;
	uploading?: boolean;
	documentCount: number;
}

const SUGGESTIONS = [
	"What are the break rights, and what conditions attach to them?",
	"How is the rent reviewed, and on what basis?",
	"Flag anything that would concern a buyer at completion.",
];

export function EmptyState({
	onUpload,
	uploading,
	documentCount,
}: EmptyStateProps) {
	// A document is loaded but nothing has been asked yet — prompt the question
	// rather than the upload.
	if (documentCount > 0) {
		return (
			<div className="flex max-w-md flex-col items-center px-4 text-center">
				<div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900">
					<FileSearch className="h-6 w-6 text-white" />
				</div>
				<h2 className="mb-1.5 text-lg font-semibold text-neutral-800">
					Document ready
				</h2>
				<p className="mb-6 text-sm text-neutral-500">
					Ask anything about it.
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
				Start with the document
			</h2>
			<p className="mb-7 max-w-sm text-center text-sm text-neutral-500">
				Upload a lease, a title report or a survey, and ask questions about it.
			</p>
			<DocumentUpload onUpload={onUpload} uploading={uploading} />
		</div>
	);
}
