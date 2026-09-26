/**
 * Writing modes for the desk.
 *
 * Client-safe module: both the composer chips and the server-side system prompt
 * read from here so a mode never drifts between the two sides.
 */

export type ModeId = "draft" | "summarize" | "critique";

export type DeskMode = {
  id: ModeId;
  label: string;
  /** Short copy for the chip tooltip / search panel. */
  blurb: string;
  /** Composer placeholder while the mode is active. */
  placeholder: string;
  /** Instructions appended to the system prompt for this turn. */
  instruction: string;
};

export const DESK_MODES: DeskMode[] = [
  {
    id: "draft",
    label: "Draft",
    blurb: "Write it from scratch, sourced",
    placeholder: "What should I write? Give me the topic, the reader, and how long.",
    instruction:
      "You are in DRAFT mode. Produce a finished piece of writing the user can ship: a title, then the body. Do not explain what you are doing or describe the plan — just write. Research anything that needs a fact, and keep claims tied to sources. Match the length the user asked for; if they did not say, aim for 350-500 words. End with nothing but the piece itself.",
  },
  {
    id: "summarize",
    label: "Summarize",
    blurb: "Compress a document or thread",
    placeholder: "Paste the text or attach the document you want compressed.",
    instruction:
      "You are in SUMMARIZE mode. Compress the material into the shortest form that loses nothing important: a one-line gist, then 3-6 bullets of the load-bearing points, then anything the user would be sorry to miss (risks, numbers, deadlines, caveats). Quote exact figures and names rather than paraphrasing them. Never invent detail that is not in the material.",
  },
  {
    id: "critique",
    label: "Critique",
    blurb: "Find the weak seams",
    placeholder: "Paste the draft you want taken apart.",
    instruction:
      "You are in CRITIQUE mode. Read closely and be useful, not gentle. Lead with the single biggest problem, then work down the list: unsupported claims, hidden assumptions, missing counter-evidence, structure that fights the reader, sentences doing no work. For each one, quote the offending line and say what would fix it. Finish with a short line on what is genuinely strong so the user keeps it.",
  },
];

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && DESK_MODES.some((mode) => mode.id === value);
}

export function modeLabel(id: unknown): string {
  return isModeId(id) ? DESK_MODES.find((mode) => mode.id === id)!.label : "Ask";
}

export function modeInstruction(id: unknown): string {
  if (!isModeId(id)) {
    return "No mode is selected, so treat this as a plain question: answer directly and honestly.";
  }
  return DESK_MODES.find((mode) => mode.id === id)!.instruction;
}

export function modePlaceholder(id: unknown): string {
  if (!isModeId(id)) return "Ask, attach, or switch mode…";
  return DESK_MODES.find((mode) => mode.id === id)!.placeholder;
}
