export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp" | "image/avif";

export type ImageSide =
  | { kind: "absent" }
  | { kind: "unsupported"; size: number }
  | { kind: "too-large"; size: number; limit: number }
  | { kind: "image"; mediaType: ImageMediaType; size: number; bytes: Uint8Array };

export interface ImagePreview {
  base: ImageSide;
  head: ImageSide;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function uint32le(bytes: Uint8Array, start: number): number {
  return ((bytes[start] ?? 0)
    | ((bytes[start + 1] ?? 0) << 8)
    | ((bytes[start + 2] ?? 0) << 16)
    | ((bytes[start + 3] ?? 0) << 24)) >>> 0;
}

/** Detect only formats Chromium accepts in an img element; never trust the repository path. */
export function imageMediaType(bytes: Uint8Array): ImageMediaType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  const dibHeaderSize = uint32le(bytes, 14);
  if (bytes.length >= 26
    && ascii(bytes, 0, 2) === "BM"
    && uint32le(bytes, 10) >= 26
    && [12, 40, 52, 56, 108, 124].includes(dibHeaderSize)) return "image/bmp";
  if (ascii(bytes, 4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 4))) return "image/avif";
  return null;
}
