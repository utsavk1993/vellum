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

export interface Message {
	id: string;
	conversation_id: string;
	role: "user" | "assistant" | "system";
	content: string;
	created_at: string;
}

export interface ConversationDetail
	extends Omit<Conversation, "document_count"> {
	documents: Document[];
}
