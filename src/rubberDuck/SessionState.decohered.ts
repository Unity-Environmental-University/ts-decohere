import { InferFromUsage } from "@decohere/ts-decohere";


/**
 * A single turn in the conversation.
 * Line-by-line discussion between user and duck.
 */
export type ConversationEntry = InferFromUsage<Record<string, any>>;

/**
 * What the UI needs to show for one line.
 */
export interface ConvoEntryUiView {
  lineText: string;
  lineNum: number;  // 1-indexed
  lineConversation: ConversationEntry[];
}

/**
 * What we store. We reconstruct line numbers from content.
 */
export interface ConvoEntryStorageView {
  lineText: string;
  lineConversation: ConversationEntry[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SESSIONSTATE: A single rubber duck debugging session record
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * User perspective:
 * - I start debugging a file at 2:30pm
 * - I walk through lines 5-12, have a conversation with the duck
 * - I close the session at 2:45pm
 * - Later, I can resume that exact session or start fresh
 *
 * Key insight: Not "the active session". A session is a record.
 * There can be many per file. Current one has endedAt: null.
 *
 * Q: Should endedAt be null or a date?
 * A: null = session ongoing. Date = session archived.
 *    Lets you query: which sessions did I have on file X?
 */
export type SessionState = {
  sessionId: string;                // Unique ID for this session
  filePath: string;
  startedAt: Date;
  endedAt: Date | null;             // null = session ongoing
  currentLineNum: number;            // 1-indexed, runtime only
  totalLines: number;
  conversationHistory: ConversationEntry[];
  fileContentHashAtStart: string;   // To detect file changes
};
