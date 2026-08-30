import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import type { Conversation } from "../types";

export function useConversations() {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setError(null);
			setConversations(await api.fetchConversations());
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to load conversations",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Open the most recent conversation on load. Landing on "select a conversation"
	// when conversations already exist is a step that asks the reader to choose before
	// showing them anything.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on the first list that arrives
	useEffect(() => {
		if (selectedId === null && conversations.length > 0) {
			setSelectedId(conversations[0]?.id ?? null);
		}
	}, [conversations]);

	const create = useCallback(async () => {
		try {
			setError(null);
			const detail = await api.createConversation();
			// The create endpoint returns the fuller detail shape; the list works in
			// summaries, and a brand-new matter has no documents yet.
			const conversation: Conversation = {
				id: detail.id,
				title: detail.title,
				created_at: detail.created_at,
				updated_at: detail.updated_at,
				document_count: 0,
			};
			setConversations((prev) => [conversation, ...prev]);
			setSelectedId(conversation.id);
			return conversation;
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to create conversation",
			);
			return null;
		}
	}, []);

	const select = useCallback((id: string | null) => {
		setSelectedId(id);
	}, []);

	const selected = conversations.find((c) => c.id === selectedId) ?? null;

	return {
		conversations,
		selected,
		selectedId,
		loading,
		error,
		create,
		select,
		refresh,
	};
}
