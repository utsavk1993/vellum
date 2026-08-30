import { Loader2, Upload } from "lucide-react";
import { type DragEvent, useCallback, useRef, useState } from "react";

interface DocumentUploadProps {
	onUpload: (files: File[]) => void;
	uploading?: boolean;
}

function pdfsFrom(list: FileList | null): File[] {
	return Array.from(list ?? []).filter(
		(file) =>
			file.type === "application/pdf" ||
			file.name.toLowerCase().endsWith(".pdf"),
	);
}

export function DocumentUpload({
	onUpload,
	uploading = false,
}: DocumentUploadProps) {
	const [dragOver, setDragOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleDrop = useCallback(
		(e: DragEvent) => {
			e.preventDefault();
			setDragOver(false);
			const files = pdfsFrom(e.dataTransfer.files);
			if (files.length > 0) onUpload(files);
		},
		[onUpload],
	);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = pdfsFrom(e.target.files);
			if (files.length > 0) onUpload(files);
			if (fileInputRef.current) fileInputRef.current.value = "";
		},
		[onUpload],
	);

	return (
		<button
			type="button"
			className={`w-full max-w-md cursor-pointer rounded-xl border-2 border-dashed px-8 py-10 text-center transition-colors ${
				dragOver
					? "border-neutral-400 bg-neutral-100"
					: "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"
			}`}
			onDragOver={(e) => {
				e.preventDefault();
				setDragOver(true);
			}}
			onDragLeave={(e) => {
				e.preventDefault();
				setDragOver(false);
			}}
			onDrop={handleDrop}
			onClick={() => fileInputRef.current?.click()}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".pdf,application/pdf"
				multiple
				className="hidden"
				onChange={handleFileChange}
			/>

			{uploading ? (
				<div className="flex flex-col items-center">
					<Loader2 className="mb-3 h-9 w-9 animate-spin text-neutral-400" />
					<p className="text-sm font-medium text-neutral-600">
						Indexing documents…
					</p>
					<p className="mt-1 text-xs text-neutral-400">
						Extracting text page by page
					</p>
				</div>
			) : (
				<div className="flex flex-col items-center">
					<Upload className="mb-3 h-9 w-9 text-neutral-400" />
					<p className="text-sm font-medium text-neutral-600">
						Drop the deal documents here
					</p>
					<p className="mt-1 text-xs text-neutral-400">
						Several PDFs at once — lease, title report, surveys
					</p>
				</div>
			)}
		</button>
	);
}
