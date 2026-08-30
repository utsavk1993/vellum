import { Streamdown } from "streamdown";
import type { Message } from "../types";

interface MessageBubbleProps {
	message: Message;
	/** Set while the text is still arriving, so the caret can be shown. */
	streaming?: boolean;
}

export function MessageBubble({ message, streaming }: MessageBubbleProps) {
	if (message.role === "user") {
		return (
			<div className="flex justify-end">
				<div className="max-w-[80%] rounded-2xl rounded-br-sm bg-neutral-900 px-4 py-2.5 text-sm text-white">
					{message.content}
				</div>
			</div>
		);
	}

	return (
		<div className="flex justify-start">
			<div className="max-w-full">
				<div className="prose">
					<Streamdown>{message.content}</Streamdown>
					{streaming && (
						<span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-neutral-400 align-middle" />
					)}
				</div>
			</div>
		</div>
	);
}
