import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";
import type { Document } from "../types";

/**
 * The documents attached to one conversation.
 *
 * Uploads run concurrently and report per-file: dropping five PDFs on a deal should
 * not mean one bad file silently takes the batch down with it.
 */
export function useDocuments(conversationId: string | null) {
	const [documents, setDocuments] = useState<Document[]>([]);
	const [uploading, setUploading] = useState(0);
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
		async (files: File[]): Promise<Document[]> => {
			if (!conversationId || files.length === 0) return [];

			setUploading((count) => count + files.length);
			setError(null);

			const results = await Promise.allSettled(
				files.map((file) => api.uploadDocument(conversationId, file)),
			);
			setUploading((count) => Math.max(0, count - files.length));

			const failures = results.flatMap((result, index) => {
				if (result.status !== "rejected") return [];
				const name = files[index]?.name ?? "file";
				return [`${name}: ${result.reason?.message ?? "upload failed"}`];
			});
			if (failures.length > 0) setError(failures.join("; "));

			await refresh();

			return results.flatMap((result) =>
				result.status === "fulfilled" ? [result.value] : [],
			);
		},
		[conversationId, refresh],
	);

	return { documents, uploading, error, upload, refresh };
}
