import { FileText, MessageSquarePlus } from "lucide-react";
import type { Conversation } from "../types";
import { ScrollArea } from "./ui/scroll-area";

interface ChatSidebarProps {
	conversations: Conversation[];
	selectedId: string | null;
	loading: boolean;
	onSelect: (id: string) => void;
	onCreate: () => void;
}

export function ChatSidebar({
	conversations,
	selectedId,
	loading,
	onSelect,
	onCreate,
}: ChatSidebarProps) {
	return (
		<aside className="flex w-64 flex-shrink-0 flex-col border-r border-neutral-200 bg-white">
			<div className="flex items-center justify-between px-3 py-3">
				<span className="text-sm font-semibold text-neutral-800">Matters</span>
				<button
					type="button"
					aria-label="New conversation"
					onClick={onCreate}
					className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
				>
					<MessageSquarePlus className="h-4 w-4" />
				</button>
			</div>

			<ScrollArea className="flex-1">
				<div className="space-y-0.5 px-2 pb-3">
					{loading && (
						<p className="px-2 py-3 text-xs text-neutral-400">Loading…</p>
					)}

					{!loading && conversations.length === 0 && (
						<p className="px-2 py-3 text-xs text-neutral-400">
							No conversations yet.
						</p>
					)}

					{conversations.map((conversation) => (
						<button
							key={conversation.id}
							type="button"
							onClick={() => onSelect(conversation.id)}
							className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
								conversation.id === selectedId
									? "bg-neutral-100"
									: "hover:bg-neutral-50"
							}`}
						>
							<span className="block truncate text-sm text-neutral-800">
								{conversation.title}
							</span>
							{conversation.document_count > 0 && (
								<span className="mt-0.5 flex items-center gap-1 text-xs text-neutral-400">
									<FileText className="h-3 w-3" />
									{conversation.document_count} document
									{conversation.document_count === 1 ? "" : "s"}
								</span>
							)}
						</button>
					))}
				</div>
			</ScrollArea>
		</aside>
	);
}
