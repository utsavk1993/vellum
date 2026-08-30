import { Loader2, Paperclip, SendHorizontal } from "lucide-react";
import { type KeyboardEvent, useCallback, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface ChatInputProps {
	onSend: (content: string) => void;
	onUpload: (file: File) => void;
	disabled: boolean;
	documentCount: number;
	uploading: boolean;
}

export function ChatInput({
	onSend,
	onUpload,
	disabled,
	documentCount,
	uploading,
}: ChatInputProps) {
	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleSend = useCallback(() => {
		const trimmed = value.trim();
		if (!trimmed || disabled) return;
		onSend(trimmed);
		setValue("");
		if (textareaRef.current) textareaRef.current.style.height = "auto";
	}, [value, disabled, onSend]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	const handleInput = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
	}, []);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) onUpload(file);
			if (fileInputRef.current) fileInputRef.current.value = "";
		},
		[onUpload],
	);

	return (
		<div className="border-t border-neutral-200 bg-white px-3 py-3">
			<div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 transition-colors focus-within:border-neutral-300 focus-within:bg-white">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 flex-shrink-0"
							aria-label="Attach a PDF"
							disabled={uploading}
							onClick={() => fileInputRef.current?.click()}
						>
							{uploading ? (
								<Loader2 className="h-4 w-4 animate-spin text-neutral-500" />
							) : (
								<Paperclip className="h-4 w-4 text-neutral-500" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Attach a PDF</TooltipContent>
				</Tooltip>

				<input
					ref={fileInputRef}
					type="file"
					accept=".pdf,application/pdf"
					className="hidden"
					onChange={handleFileChange}
				/>

				<textarea
					ref={textareaRef}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onInput={handleInput}
					onKeyDown={handleKeyDown}
					placeholder={
						documentCount === 0
							? "Upload a document to get started…"
							: "Ask a question about this document…"
					}
					rows={1}
					className="max-h-[200px] min-h-[24px] flex-1 resize-none self-center bg-transparent text-sm leading-6 text-neutral-800 placeholder-neutral-400 outline-none"
					disabled={disabled}
				/>

				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 flex-shrink-0"
					aria-label="Send message"
					disabled={!value.trim() || disabled}
					onClick={handleSend}
				>
					<SendHorizontal
						className={`h-4 w-4 transition-colors ${
							value.trim() && !disabled
								? "text-neutral-900"
								: "text-neutral-300"
						}`}
					/>
				</Button>
			</div>
		</div>
	);
}
