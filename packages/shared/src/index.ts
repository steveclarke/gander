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

export interface PrSummary {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  baseRef: string;
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

export interface PrView { pr: PrSummary; files: PrFile[]; }

/** "https://github.com/o/r(.git)" | "git@github.com:o/r(.git)" -> "o/r" */
export function repoIdFromUrl(url: string): string {
  const m =
    url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ??
    url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Not a GitHub repository URL: ${url}`);
  return `${m[1]}/${m[2]}`;
}
