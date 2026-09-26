type Part = { type?: string; text?: string; filename?: string };

/** Plain-text view of a stored message: text parts plus attachment names. */
export function messageText(content: unknown): { text: string; attachments: string[] } {
  const parts = ((content as { parts?: Part[] } | null)?.parts ?? []) as Part[];
  const text = parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n")
    .trim();
  const attachments = parts.filter((p) => p.type === "file").map((p) => p.filename ?? "attachment");
  return { text, attachments };
}

export type DeskRow = { sdk_id: string; role: string; content: unknown; created_at: string };

export const toTurnJson = (row: DeskRow) => {
  const { text, attachments } = messageText(row.content);
  return { id: row.sdk_id, role: row.role, createdAt: row.created_at, text, attachments };
};
