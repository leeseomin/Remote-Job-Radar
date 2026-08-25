import type { SourceCompletePayload } from "@remote-job-radar/contracts";

export type SourceCompletionDisposition =
  | { kind: "complete"; reason: null }
  | { kind: "retry" | "quarantine"; reason: string };

const SEVERE_SIGNAL_PATTERN =
  /captcha|login|required-selector-not-found|jsonld-jobposting-not-found|schema-invalid|all-title|empty-title|response-too-short/i;

function permanentFailureReason(payload: SourceCompletePayload): string | null {
  const details = [payload.errorCode, payload.errorMessage].filter(Boolean).join(" ");
  if (/captcha/i.test(details)) return "captcha-page";
  if (/login/i.test(details)) return "login-page";
  if (/selector/i.test(details)) return "required-selector-not-found";
  if (/schema|unexpected (?:token|end)|json|omitted jobs|must be an array|all-title|empty-title/i.test(details)) {
    return "schema-invalid";
  }
  if (/blocked (?:url|private|local)|private ip|local hostname|embedded credentials|blocked url protocol/i.test(details)) {
    return "unsafe-source-url";
  }
  if (/requires?(?: config| adapterkey| listselector)|invalid url|too many redirects|unsupported (?:content-type|job url)|response (?:exceeded|content-length)/i.test(details)) {
    return "source-configuration-invalid";
  }
  return null;
}

function isRetryableHttpStatus(status: number | null): boolean {
  return status === 408 || status === 425 || status === 429 || (status !== null && status >= 500);
}

function httpFailureReason(status: number | null): string | null {
  return status !== null && status >= 400 ? `http-${status}` : null;
}

export function classifySourceCompletion(
  payload: SourceCompletePayload,
  storedBatches: number,
): SourceCompletionDisposition {
  const suspiciousSignal = payload.signals.find((signal) => SEVERE_SIGNAL_PATTERN.test(signal));
  if (suspiciousSignal) return { kind: "quarantine", reason: suspiciousSignal };

  if (payload.status === "not_modified") {
    const httpReason = httpFailureReason(payload.httpStatus);
    if (httpReason) {
      return {
        kind: isRetryableHttpStatus(payload.httpStatus) ? "retry" : "quarantine",
        reason: httpReason,
      };
    }
    if (payload.expectedBatchCount !== 0 || payload.receivedBatchCount !== 0 || storedBatches !== 0) {
      return { kind: "retry", reason: "not-modified-batch-count-mismatch" };
    }
    return { kind: "complete", reason: null };
  }

  if (payload.status === "quarantined") {
    return {
      kind: "quarantine",
      reason: payload.errorCode ?? payload.signals[0] ?? "crawler-reported-quarantine",
    };
  }

  if (payload.status === "failed") {
    const permanentReason = permanentFailureReason(payload);
    if (permanentReason) return { kind: "quarantine", reason: permanentReason };

    const httpReason = httpFailureReason(payload.httpStatus);
    if (httpReason && !isRetryableHttpStatus(payload.httpStatus)) {
      return { kind: "quarantine", reason: httpReason };
    }
    return {
      kind: "retry",
      reason: httpReason ?? payload.errorCode ?? "crawler-reported-failure",
    };
  }

  if (payload.previousJobCount >= 5 && payload.fetchedJobCount === 0) {
    return { kind: "quarantine", reason: "unexpected-zero-jobs" };
  }
  if (payload.previousJobCount >= 5 && payload.fetchedJobCount <= Math.floor(payload.previousJobCount * 0.2)) {
    return { kind: "quarantine", reason: "job-count-dropped-80-percent" };
  }

  const httpReason = httpFailureReason(payload.httpStatus);
  if (httpReason) {
    return {
      kind: isRetryableHttpStatus(payload.httpStatus) ? "retry" : "quarantine",
      reason: httpReason,
    };
  }
  if (payload.expectedBatchCount !== payload.receivedBatchCount || storedBatches !== payload.expectedBatchCount) {
    return { kind: "retry", reason: "batch-count-mismatch" };
  }

  return { kind: "complete", reason: null };
}
