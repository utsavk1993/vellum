import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import type { Citation, Message } from "../types";

/**
 * The transcript for one conversation, plus the in-flight answer.
 *
 * The SSE stream is read by hand rather than with EventSource, because the request
 * is a POST carrying the question and EventSource can only issue a GET.
 */
export function useMessages(conversationId: string | null) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [streamingContent, setStreamingContent] = useState("");
	// Citations arrive mid-answer, each already carrying the server's verdict, so the
	// marker can render in its final state the moment it appears.
	const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setMessages([]);
			return;
		}
		setLoading(true);
		try {
			setError(null);
			setMessages(await api.fetchMessages(conversationId));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load messages");
		} finally {
			setLoading(false);
		}
	}, [conversationId]);

	useEffect(() => {
		setStreamingContent("");
		setStreamingCitations([]);
		refresh();
	}, [refresh]);

	const send = useCallback(
		async (content: string) => {
			if (!conversationId || streaming) return;

			const optimistic: Message = {
				id: `pending-${Date.now()}`,
				conversation_id: conversationId,
				role: "user",
				content,
				created_at: new Date().toISOString(),
				citations: [],
			};
			setMessages((prev) => [...prev, optimistic]);
			setStreaming(true);
			setStreamingContent("");
			setStreamingCitations([]);
			setError(null);

			try {
				const response = await api.sendMessage(conversationId, content);
				const reader = response.body?.getReader();
				if (!reader) throw new Error("No response body");

				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });

					// SSE frames are separated by a blank line. A frame split across two
					// reads must be held back rather than parsed as JSON half-formed.
					const frames = buffer.split("\n\n");
					buffer = frames.pop() ?? "";

					for (const frame of frames) {
						const line = frame.split("\n").find((l) => l.startsWith("data: "));
						if (!line) continue;
						const event = JSON.parse(line.slice(6));

						if (event.type === "content") {
							setStreamingContent((prev) => prev + event.content);
						} else if (event.type === "citation") {
							setStreamingCitations((prev) => [
								...prev,
								event.citation as Citation,
							]);
						} else if (event.type === "message") {
							setMessages((prev) => [...prev, event.message as Message]);
							setStreamingContent("");
							setStreamingCitations([]);
						}
					}
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Something went wrong");
			} finally {
				setStreaming(false);
				setStreamingContent("");
				setStreamingCitations([]);
				refresh();
			}
		},
		[conversationId, streaming, refresh],
	);

	return {
		messages,
		loading,
		error,
		streaming,
		streamingContent,
		streamingCitations,
		send,
		refresh,
	};
}
