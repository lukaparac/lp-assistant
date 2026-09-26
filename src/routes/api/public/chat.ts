import { createFileRoute } from "@tanstack/react-router";
import { handleChat } from "@/lib/chat.server";

export const Route = createFileRoute("/api/public/chat")({
  server: {
    handlers: {
      POST: ({ request }) => handleChat(request),
    },
  },
});
