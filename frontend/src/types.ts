export interface Conversation {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	document_count: number;
}

export interface Document {
	id: string;
	conversation_id: string;
	filename: string;
	page_count: number;
	/** False when the PDF held no extractable text — a scan the agent cannot read. */
	has_text: boolean;
	uploaded_at: string;
}

export interface Citation {
	ordinal: number;
	document_id: string;
	page_number: number;
	quote: string;
	/** Set by the server after checking the quote against the cited page's text. */
	verified: boolean;
}

export interface Message {
	id: string;
	conversation_id: string;
	role: "user" | "assistant" | "system";
	content: string;
	created_at: string;
	citations: Citation[];
}

export interface ConversationDetail
	extends Omit<Conversation, "document_count"> {
	documents: Document[];
}

/** What the reader panel is currently being asked to show. */
export interface ViewerTarget {
	documentId: string;
	page: number;
	/** Text to highlight on that page, when the jump came from a citation. */
	quote?: string;
}
