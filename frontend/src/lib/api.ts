import type {
	Conversation,
	ConversationDetail,
	Document,
	Message,
} from "../types";

const BASE = "/api";

async function handleResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw new Error(await describeError(response));
	}
	return response.json() as Promise<T>;
}

/** Surface the API's own message rather than a bare status code. */
async function describeError(response: Response): Promise<string> {
	try {
		const body = await response.json();
		if (body && typeof body.detail === "string") return body.detail;
	} catch {
		// Not JSON — fall through to the generic form.
	}
	return `Request failed (${response.status})`;
}

export async function fetchConversations(): Promise<Conversation[]> {
	return handleResponse<Conversation[]>(await fetch(`${BASE}/conversations`));
}

export async function createConversation(): Promise<ConversationDetail> {
	const res = await fetch(`${BASE}/conversations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({}),
	});
	return handleResponse<ConversationDetail>(res);
}

export async function fetchConversation(
	id: string,
): Promise<ConversationDetail> {
	return handleResponse<ConversationDetail>(
		await fetch(`${BASE}/conversations/${id}`),
	);
}

export async function fetchMessages(
	conversationId: string,
): Promise<Message[]> {
	return handleResponse<Message[]>(
		await fetch(`${BASE}/conversations/${conversationId}/messages`),
	);
}

export async function sendMessage(
	conversationId: string,
	content: string,
	signal?: AbortSignal,
): Promise<Response> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content }),
		signal,
	});
	if (!res.ok) throw new Error(await describeError(res));
	return res;
}

export async function fetchDocuments(
	conversationId: string,
): Promise<Document[]> {
	return handleResponse<Document[]>(
		await fetch(`${BASE}/conversations/${conversationId}/documents`),
	);
}

export async function uploadDocument(
	conversationId: string,
	file: File,
): Promise<Document> {
	const formData = new FormData();
	formData.append("file", file);
	const res = await fetch(`${BASE}/conversations/${conversationId}/documents`, {
		method: "POST",
		body: formData,
	});
	return handleResponse<Document>(res);
}

export function getDocumentUrl(documentId: string): string {
	return `${BASE}/documents/${documentId}/content`;
}
