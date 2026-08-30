import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Document, Message } from "../types";
import { ChatInput } from "./ChatInput";
import { EmptyState } from "./EmptyState";
import { MessageBubble } from "./MessageBubble";
import { ScrollArea } from "./ui/scroll-area";

interface ChatWindowProps {
	messages: Message[];
	documents: Document[];
	loading: boolean;
	error: string | null;
	streaming: boolean;
	streamingContent: string;
	uploading: boolean;
	conversationId: string | null;
	conversationTitle: string | null;
	onSend: (content: string) => void;
	onUpload: (file: File) => void;
	onNewConversation: () => void;
}

export function ChatWindow({
	messages,
	documents,
	loading,
	error,
	streaming,
	streamingContent,
	uploading,
	conversationId,
	conversationTitle,
	onSend,
	onUpload,
	onNewConversation,
}: ChatWindowProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the streamed text is what moves the bottom
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length, streamingContent]);

	if (!conversationId) {
		return (
			<main className="flex flex-1 flex-col items-center justify-center bg-neutral-50">
				<p className="mb-4 text-sm text-neutral-500">
					No conversation selected.
				</p>
				<button
					type="button"
					onClick={onNewConversation}
					className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700"
				>
					Start one
				</button>
			</main>
		);
	}

	const empty = messages.length === 0 && !streaming;

	return (
		<main className="flex min-w-0 flex-1 flex-col bg-neutral-50">
			<header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
				<h1 className="truncate text-sm font-semibold text-neutral-800">
					{conversationTitle ?? "New Conversation"}
				</h1>
				{documents.length > 0 && (
					<span className="text-xs text-neutral-400">
						{documents[0]?.filename}
					</span>
				)}
			</header>

			{error && (
				<div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
					{error}
				</div>
			)}

			<ScrollArea className="flex-1">
				{loading ? (
					<div className="flex h-full items-center justify-center py-16">
						<Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
					</div>
				) : empty ? (
					<div className="flex h-full items-center justify-center py-16">
						<EmptyState
							onUpload={onUpload}
							uploading={uploading}
							documentCount={documents.length}
						/>
					</div>
				) : (
					<div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
						{messages.map((message) => (
							<MessageBubble key={message.id} message={message} />
						))}

						{streaming && streamingContent && (
							<MessageBubble
								streaming
								message={{
									id: "streaming",
									conversation_id: conversationId,
									role: "assistant",
									content: streamingContent,
									created_at: new Date().toISOString(),
								}}
							/>
						)}

						{streaming && !streamingContent && (
							<div className="flex items-center gap-2 text-sm text-neutral-400">
								<Loader2 className="h-4 w-4 animate-spin" />
								Reading the document…
							</div>
						)}

						<div ref={bottomRef} />
					</div>
				)}
			</ScrollArea>

			<ChatInput
				onSend={onSend}
				onUpload={onUpload}
				disabled={streaming}
				documentCount={documents.length}
				uploading={uploading}
			/>
		</main>
	);
}
