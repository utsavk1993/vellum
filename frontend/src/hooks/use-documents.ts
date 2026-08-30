import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import type { Document } from "../types";

/** The document attached to one conversation. */
export function useDocuments(conversationId: string | null) {
	const [documents, setDocuments] = useState<Document[]>([]);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setDocuments([]);
			return;
		}
		try {
			setError(null);
			setDocuments(await api.fetchDocuments(conversationId));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load documents");
		}
	}, [conversationId]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const upload = useCallback(
		async (file: File): Promise<Document | null> => {
			if (!conversationId) return null;
			setUploading(true);
			setError(null);
			try {
				const document = await api.uploadDocument(conversationId, file);
				await refresh();
				return document;
			} catch (err) {
				setError(err instanceof Error ? err.message : "Upload failed");
				return null;
			} finally {
				setUploading(false);
			}
		},
		[conversationId, refresh],
	);

	return { documents, uploading, error, upload, refresh };
}
