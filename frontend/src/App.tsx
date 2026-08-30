import { useCallback, useEffect, useState } from "react";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatWindow } from "./components/ChatWindow";
import { DocumentViewer } from "./components/DocumentViewer";
import { TooltipProvider } from "./components/ui/tooltip";
import { useConversations } from "./hooks/use-conversations";
import { useDocuments } from "./hooks/use-documents";
import { useMessages } from "./hooks/use-messages";
import type { Citation, ViewerTarget } from "./types";

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
		streamingCitations,
		retrying,
		send,
	} = useMessages(selectedId);

	const {
		documents,
		uploading,
		error: documentsError,
		upload,
	} = useDocuments(selectedId);

	// The viewer's target lives here because two panes drive it: the reader's own
	// page controls, and a citation clicked over in the chat.
	const [target, setTarget] = useState<ViewerTarget | null>(null);

	// Switching matters must clear the target, or the viewer keeps pointing at a
	// document belonging to the conversation the user just left.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedId is the trigger, not a value read here
	useEffect(() => {
		setTarget(null);
	}, [selectedId]);

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
			const uploaded = await upload(files);
			refreshConversations();
			// Show the first document that landed, so the upload visibly did something.
			const first = uploaded[0];
			if (first) {
				setTarget({ documentId: first.id, page: 1 });
			}
		},
		[upload, refreshConversations],
	);

	const handleDocumentClick = useCallback((documentId: string) => {
		setTarget({ documentId, page: 1 });
	}, []);

	const handleCitationClick = useCallback((citation: Citation) => {
		setTarget({
			documentId: citation.document_id,
			page: citation.page_number,
			quote: citation.quote,
		});
	}, []);

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
					streamingCitations={streamingCitations}
					retrying={retrying}
					uploading={uploading}
					conversationId={selectedId}
					conversationTitle={selected?.title ?? null}
					onSend={handleSend}
					onUpload={handleUpload}
					onCitationClick={handleCitationClick}
					onDocumentClick={handleDocumentClick}
					onNewConversation={create}
				/>

				<DocumentViewer
					documents={documents}
					target={target}
					onTargetChange={setTarget}
				/>
			</div>
		</TooltipProvider>
	);
}
