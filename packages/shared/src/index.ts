import { z } from "zod";

/** The service API version this workspace implements and the desktop app understands. */
/**
 * The version of the wire contract between the app and the service, checked when the app
 * connects.
 *
 * **Bump this in the same change that alters the contract** — a route added or removed, a
 * field a response gains that the app relies on, a payload shape the service starts
 * requiring. It is the only thing that lets a running app tell a service that is behind it
 * from one that is level with it. Leaving it alone means a stale service answers "the
 * version you wanted", and the mismatch surfaces later as a 404 in the middle of a review.
 *
 * Not the app's release version: releases happen far more often than the contract moves.
 */
export const SERVICE_VERSION = "0.6.0";

export const FileStatusSchema = z.enum(["A", "M", "D", "R"]);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const FileCheckoffSchema = z.object({
  path: z.string().min(1),
  checked: z.boolean(),
  baseHash: z.string().nullable(),
  headHash: z.string().nullable(),
  checkedAt: z.string().nullable(),
  machine: z.string().nullable(),
});
export type FileCheckoff = z.infer<typeof FileCheckoffSchema>;

export const ReviewStateSchema = z.object({
  repoId: z.string().regex(/^[^/]+\/[^/]+$/),
  prNumber: z.number().int().positive(),
  files: z.array(FileCheckoffSchema),
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const PutFileStateSchema = z.discriminatedUnion("checked", [
  z.object({
    checked: z.literal(true),
    path: z.string().min(1),
    baseHash: z.string().nullable(),
    headHash: z.string().nullable(),
    baseContent: z.string().nullable(),
    headContent: z.string().nullable(),
    machine: z.string().min(1),
  }),
  z.object({ checked: z.literal(false), path: z.string().min(1) }),
]);
export type PutFileState = z.infer<typeof PutFileStateSchema>;

export const NoteStateSchema = z.enum(["open", "in_progress", "addressed", "resolved"]);
export type NoteState = z.infer<typeof NoteStateSchema>;

export const NoteSourceContextSchema = z.object({
  /** 1-based line number of the first captured line. */
  startLine: z.number().int().positive(),
  /** Immutable lines from the head revision the reviewer was reading. */
  lines: z.array(z.string()).min(1),
});
export type NoteSourceContext = z.infer<typeof NoteSourceContextSchema>;

export const NoteSchema = z.object({
  id: z.number().int().positive(),
  /** null for a note about the pull request as a whole rather than one file. */
  path: z.string().nullable(),
  /** 1-based line in the head revision, stamped when a line was selected at capture. */
  line: z.number().int().positive().nullable(),
  text: z.string().min(1),
  state: NoteStateSchema,
  /** Head the branch was at when the note was captured. */
  headSha: z.string().nullable(),
  /** Source surrounding the selected line, captured before the branch can move. */
  sourceContext: NoteSourceContextSchema.nullable(),
  /** Why an in-progress note is waiting for the reviewer. */
  inProgressNote: z.string().nullable(),
  /** Commit an agent named when it marked the note addressed. */
  commitRef: z.string().nullable(),
  /** One-line summary an agent left when it marked the note addressed. */
  summary: z.string().nullable(),
  createdAt: z.string(),
});
export type Note = z.infer<typeof NoteSchema>;

export const NewNoteSchema = z.object({
  path: z.string().min(1).nullable(),
  line: z.number().int().positive().nullable(),
  text: z.string().min(1),
  /** Head the branch was at when this was captured, so a moved line can be spotted later. */
  headSha: z.string().min(1).nullable(),
  /** Source surrounding the selected line, captured from the same head revision. */
  sourceContext: NoteSourceContextSchema.nullable(),
});
export type NewNote = z.infer<typeof NewNoteSchema>;

export const UpdateNoteSchema = z.object({
  text: z.string().min(1).optional(),
  state: NoteStateSchema.optional(),
}).refine((input) => input.text !== undefined || input.state !== undefined, {
  message: "text or state is required",
});
export type UpdateNote = z.infer<typeof UpdateNoteSchema>;

/** What the service remembers about a pull request, so agents can be told which one they are on. */
export const PrContextSchema = z.object({
  headRef: z.string().min(1),
  title: z.string(),
  headSha: z.string().min(1),
  /** Shared by every pull request in a GitHub stack; null when the pull request stands alone. */
  stackId: z.number().int().positive().nullable(),
  stackSize: z.number().int().positive().nullable(),
  stackPosition: z.number().int().positive().nullable(),
});
export type PrContext = z.infer<typeof PrContextSchema>;

export const MarkAddressedSchema = z.object({
  commitRef: z.string().min(1).nullable(),
  summary: z.string().min(1).nullable(),
});
export type MarkAddressed = z.infer<typeof MarkAddressedSchema>;

export const MarkInProgressSchema = z.object({
  note: z.string().min(1).nullable(),
});
export type MarkInProgress = z.infer<typeof MarkInProgressSchema>;

export interface PrSummary {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  baseRef: string;
  /** The pull request's own branch. Lets the service resolve branch -> PR for agents. */
  headRef: string;
  /** Position in a GitHub stacked pull request, or null when the pull request stands alone. */
  stack: { id: number; size: number; position: number } | null;
  baseSha: string;
  headSha: string;
}

export interface ReviewProgress { done: number; total: number; }

/** GitHub's pull request summary joined with content-derived review progress. */
export interface PrListItem extends PrSummary {
  /** null until at least one file has a retained review snapshot. */
  reviewProgress: ReviewProgress | null;
}

export interface RepoEntry {
  repoId: string;
  url: string;
  /** A machine-local checkout used to discover worktrees. Never sent to the review service. */
  localPath: string;
}

export interface ChangedFile {
  path: string;
  /** Original path at the merge base when this file is a rename. */
  basePath?: string;
  status: FileStatus;
  baseContent: string | null;
  headContent: string | null;
  baseHash: string | null;
  headHash: string | null;
}

export interface PrFile extends ChangedFile {
  checked: boolean;
  changedSince: boolean;
}

export interface PrView { pr: PrSummary; files: PrFile[]; notes: Note[]; }

export interface LocalWorktree {
  path: string;
  headSha: string;
  branch: string | null;
  locked: boolean;
}

export interface LocalView {
  worktree: LocalWorktree;
  defaultBranch: string;
  mergeBaseSha: string;
  files: ChangedFile[];
}

/** A path in the selected worktree's complete, git-aware Explorer. */
export interface LocalFileEntry {
  path: string;
  kind: "directory" | "file";
}

/** One lazily-read worktree file. Local browsing never creates review state. */
export interface LocalFile {
  path: string;
  content: string | null;
  hash: string;
  binary: boolean;
}

/** "https://github.com/o/r(.git)" | "git@github.com:o/r(.git)" -> "o/r" */
export function repoIdFromUrl(url: string): string {
  const m =
    url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ??
    url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/) ??
    url.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`Not a GitHub repository URL: ${url}`);
  return `${m[1]}/${m[2]}`;
}

/** A repository, and optionally a pull request in it, that the app was asked to open. */
export const OpenTargetSchema = z.object({
  repoId: z.string().regex(/^[^/]+\/[^/]+$/),
  prNumber: z.number().int().positive().nullable(),
});
export type OpenTarget = z.infer<typeof OpenTargetSchema>;

/**
 * The sentence a connection failure produces, in one place because the renderer
 * recognizes it by shape. When the health poll recovers, the banner clears itself
 * only for a reason that was a reach failure — so a producer wording this
 * differently would leave a stale banner on screen with nothing to dismiss it, and
 * no test would fail. Build it here, and ask here whether a message is one.
 */
export const unreachableReason = (base: string, detail: string): string => `Could not reach ${base}: ${detail}`;

/** Whether `message` is an `unreachableReason` for an http(s) service. */
export const isUnreachableReason = (message: string): boolean =>
  /^Could not reach https?:\/\/\S+: [^\n]+$/.test(message);
