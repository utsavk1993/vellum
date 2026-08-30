import { useCallback } from "react";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatWindow } from "./components/ChatWindow";
import { TooltipProvider } from "./components/ui/tooltip";
import { useConversations } from "./hooks/use-conversations";
import { useDocuments } from "./hooks/use-documents";
import { useMessages } from "./hooks/use-messages";

export default function App() {
	const {
		conversations,
		selected,
		selectedId,
		loading: conversationsLoading,
		create,
		select,
		refresh: refreshConversations,
	} = useConversations();

	const {
		messages,
		loading: messagesLoading,
		error: messagesError,
		streaming,
		streamingContent,
		send,
	} = useMessages(selectedId);

	const {
		documents,
		uploading,
		error: documentsError,
		upload,
	} = useDocuments(selectedId);

	const handleSend = useCallback(
		async (content: string) => {
			await send(content);
			// The first question names the conversation, so the sidebar is stale
			// until the answer lands.
			refreshConversations();
		},
		[send, refreshConversations],
	);

	const handleUpload = useCallback(
		async (files: File[]) => {
			await upload(files);
			refreshConversations();
		},
		[upload, refreshConversations],
	);

	return (
		<TooltipProvider delayDuration={200}>
			<div className="flex h-screen bg-neutral-50">
				<ChatSidebar
					conversations={conversations}
					selectedId={selectedId}
					loading={conversationsLoading}
					onSelect={select}
					onCreate={create}
				/>

				<ChatWindow
					messages={messages}
					documents={documents}
					loading={messagesLoading}
					error={messagesError ?? documentsError}
					streaming={streaming}
					streamingContent={streamingContent}
					uploading={uploading}
					conversationId={selectedId}
					conversationTitle={selected?.title ?? null}
					onSend={handleSend}
					onUpload={handleUpload}
					onNewConversation={create}
				/>
			</div>
		</TooltipProvider>
	);
}
