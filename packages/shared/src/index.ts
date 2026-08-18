import { z } from "zod";

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

export const QuestionStateSchema = z.enum(["open", "addressed", "resolved"]);
export type QuestionState = z.infer<typeof QuestionStateSchema>;

export const QuestionSchema = z.object({
  id: z.number().int().positive(),
  /** null for a note about the pull request as a whole rather than one file. */
  path: z.string().nullable(),
  /** 1-based line in the head revision, stamped when a line was selected at capture. */
  line: z.number().int().positive().nullable(),
  text: z.string().min(1),
  state: QuestionStateSchema,
  /** Head the branch was at when the question was captured. */
  headSha: z.string().nullable(),
  /** Commit an agent named when it marked the question addressed. */
  commitRef: z.string().nullable(),
  /** One-line note an agent left when it marked the question addressed. */
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const NewQuestionSchema = z.object({
  path: z.string().min(1).nullable(),
  line: z.number().int().positive().nullable(),
  text: z.string().min(1),
  /** Head the branch was at when this was captured, so a moved line can be spotted later. */
  headSha: z.string().min(1).nullable(),
});
export type NewQuestion = z.infer<typeof NewQuestionSchema>;

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
  note: z.string().min(1).nullable(),
});
export type MarkAddressed = z.infer<typeof MarkAddressedSchema>;

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

export interface RepoEntry { repoId: string; url: string; }

export interface PrFile {
  path: string;
  status: FileStatus;
  baseContent: string | null;
  headContent: string | null;
  baseHash: string | null;
  headHash: string | null;
  checked: boolean;
  changedSince: boolean;
}

export interface PrView { pr: PrSummary; files: PrFile[]; questions: Question[]; }

/** "https://github.com/o/r(.git)" | "git@github.com:o/r(.git)" -> "o/r" */
export function repoIdFromUrl(url: string): string {
  const m =
    url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ??
    url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Not a GitHub repository URL: ${url}`);
  return `${m[1]}/${m[2]}`;
}

/** A repository, and optionally a pull request in it, that the app was asked to open. */
export const OpenTargetSchema = z.object({
  repoId: z.string().regex(/^[^/]+\/[^/]+$/),
  prNumber: z.number().int().positive().nullable(),
});
export type OpenTarget = z.infer<typeof OpenTargetSchema>;
