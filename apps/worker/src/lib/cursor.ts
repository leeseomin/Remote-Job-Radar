import { ApiError } from "./errors";
import { base64UrlToBytes, bytesToBase64Url } from "./crypto";

export interface JobCursor {
  score: number;
  firstSeenAt: number;
  id: string;
}

export function encodeCursor(cursor: JobCursor): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

export function decodeCursor(value: string): JobCursor {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Partial<JobCursor>;
    if (
      typeof parsed.score !== "number" ||
      typeof parsed.firstSeenAt !== "number" ||
      typeof parsed.id !== "string"
    ) {
      throw new Error("invalid cursor fields");
    }
    return { score: parsed.score, firstSeenAt: parsed.firstSeenAt, id: parsed.id };
  } catch {
    throw new ApiError(422, "INVALID_CURSOR", "페이지 커서가 올바르지 않습니다.");
  }
}
