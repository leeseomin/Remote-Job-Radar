import {
  defaultTargetProfile,
  type AsyncLevel,
  type ClassificationInput,
  type ClassificationResult,
  type Eligibility,
  type Evidence,
  type RemoteScope,
  type TargetProfile,
  type WorkplaceType,
} from "./types";
import {
  findSnippet,
  normalizeForMatch,
  normalizeWhitespace,
  uniqueCaseInsensitive,
} from "./text";

const WORLDWIDE_PATTERNS = [
  /\bworldwide\b/,
  /\bwork from anywhere\b/,
  /\bremote from anywhere\b/,
  /\banywhere in the world\b/,
  /\bworldwide remote\b/,
  /\bglobal remote\b/,
  /\bopen to candidates globally\b/,
  /\bhire(?:s|ing)? globally\b/,
];
const APAC_PATTERNS = [
  /\bapac\b/,
  /\basia[- ]pacific\b/,
  /\bremote[^.\n]{0,80}\basia\b/,
  /\basia time zones?\b/,
];
const REGION_LIMITED_PATTERNS = [
  /\b(?:us|u\.s\.|united states) only\b/,
  /\bmust (?:be )?(?:located|based|reside) in (?:the )?(?:us|u\.s\.|united states)\b/,
  /\bcanada only\b/,
  /\beu only\b/,
  /\buk only\b/,
  /\beurope only\b/,
  /\bemea only\b/,
  /\bremote within (?:the )?(?:us|united states|canada|eu|uk|europe)\b/,
];
const REMOTE_PATTERNS = [
  /\bremote\b/,
  /\bdistributed team\b/,
  /\bwork from home\b/,
  /\bhome[- ]based\b/,
];
const HYBRID_PATTERNS = [
  /\bhybrid\b/,
  /\b\d+ days? (?:a|per) week (?:in|at) (?:the )?office\b/,
  /\boffice attendance\b/,
];
const ONSITE_PATTERNS = [
  /\bonsite\b/,
  /\bon-site\b/,
  /\bin[- ]office\b/,
  /\bwork from (?:our|the) office\b/,
];
const OWNERSHIP_PATTERNS = [
  /\b0\s*(?:→|->|to)\s*1\b/,
  /\bzero[- ]to[- ]one\b/,
  /\bend[- ]to[- ]end ownership\b/,
  /\bown (?:the )?(?:product|feature|roadmap|outcome)\b/,
  /\bship products?\b/,
];
const COMPENSATION_PATTERNS = [
  /\b(?:salary|compensation|pay range|base pay)\b/,
  /[$€£]\s?\d{2,3}(?:[,\s]\d{3})/,
];

function matchFirst(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

function detectWorkplace(text: string): WorkplaceType {
  if (matchFirst(text, HYBRID_PATTERNS)) return "hybrid";
  if (matchFirst(text, ONSITE_PATTERNS) && !matchFirst(text, REMOTE_PATTERNS)) {
    return "onsite";
  }
  if (matchFirst(text, REMOTE_PATTERNS)) return "remote";
  if (matchFirst(text, ONSITE_PATTERNS)) return "onsite";
  return "unknown";
}

function detectRemoteScope(text: string): RemoteScope {
  // Explicit residence restrictions must override broad company-level phrases
  // such as "global remote team" that can appear elsewhere in the posting.
  if (matchFirst(text, REGION_LIMITED_PATTERNS)) return "region-limited";
  if (/\b(?:south korea|republic of korea|korea)\b/.test(text)) {
    return "country-list";
  }
  if (matchFirst(text, APAC_PATTERNS)) return "apac";
  if (matchFirst(text, WORLDWIDE_PATTERNS)) return "worldwide";
  return "unknown";
}

function detectEligibility(
  text: string,
  workplace: WorkplaceType,
  scope: RemoteScope,
): Eligibility {
  if (workplace === "onsite" || workplace === "hybrid") return "no";
  if (/\b(?:south korea|republic of korea|korea)\b/.test(text)) return "yes";
  if (scope === "worldwide") return "yes";
  if (scope === "apac") return "likely";
  if (scope === "region-limited") return "no";
  return "unknown";
}

function detectAsync(
  text: string,
  profile: TargetProfile,
): { level: AsyncLevel; positives: string[]; negatives: string[] } {
  const positives = profile.asyncPositive.filter((term) => text.includes(term));
  const negatives = profile.asyncNegative.filter((term) => text.includes(term));
  const explicit = [
    "async-first",
    "no core hours",
    "asynchronous by default",
    "default to asynchronous",
  ].some((term) => text.includes(term));

  if (explicit) return { level: "explicit", positives, negatives };
  if (negatives.length > 0 && positives.length === 0) {
    return { level: "synchronous", positives, negatives };
  }
  if (positives.length >= 2) return { level: "strong", positives, negatives };
  if (positives.length === 1) return { level: "weak", positives, negatives };
  return { level: "unknown", positives, negatives };
}

function detectTimezone(text: string): string | null {
  const named = text.match(
    /\b(?:UTC|GMT)\s?[+-]\s?\d{1,2}(?::\d{2})?|\b(?:PST|PDT|PT|MST|MDT|MT|CST|CDT|CT|EST|EDT|ET|CET|CEST|EET|JST|KST|AEST|AEDT)\b/i,
  );
  return named?.[0]?.toUpperCase().replace(/\s+/g, "") ?? null;
}

function detectOverlap(text: string): number | null {
  const match = text.match(
    /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s+(?:of\s+)?(?:daily\s+)?(?:overlap|crossover)\b/i,
  );
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function detectSkills(text: string, profile: TargetProfile): string[] {
  const aliases: Record<string, string> = {
    threejs: "Three.js",
    "three.js": "Three.js",
    webgl: "WebGL",
    webgpu: "WebGPU",
    glsl: "GLSL",
    canvas: "Canvas",
    svg: "SVG",
    pixijs: "PixiJS",
    "pixi.js": "PixiJS",
    "babylon.js": "Babylon.js",
    visualization: "Visualization",
  };
  return uniqueCaseInsensitive(
    profile.skills.strong
      .filter((term) => text.includes(term))
      .map((term) => aliases[term] ?? term),
  ).slice(0, 40);
}

function addEvidence(
  evidence: Evidence[],
  item: Evidence,
): void {
  if (evidence.length >= 12) return;
  evidence.push({ ...item, text: normalizeWhitespace(item.text).slice(0, 500) });
}

export function classifyJob(
  input: ClassificationInput,
  profile: TargetProfile = defaultTargetProfile,
): ClassificationResult {
  const original = normalizeWhitespace(
    [input.title, input.locationText ?? "", input.descriptionText].join("\n"),
  );
  const text = normalizeForMatch(original);
  const title = normalizeForMatch(input.title);
  const location = normalizeForMatch(input.locationText ?? "");
  const workplaceType = detectWorkplace(`${location}\n${text}`);
  const remoteScope = detectRemoteScope(`${location}\n${text}`);
  const eligibleFromKorea = detectEligibility(
    `${location}\n${text}`,
    workplaceType,
    remoteScope,
  );
  const asyncResult = detectAsync(text, profile);
  const requiredTimezone = detectTimezone(text);
  const requiredOverlapHours = detectOverlap(text);
  const skills = detectSkills(text, profile);
  const evidence: Evidence[] = [];
  let score = 0;

  if (eligibleFromKorea === "yes") {
    score += 30;
    addEvidence(evidence, {
      field: "eligibleFromKorea",
      effect: 30,
      text:
        remoteScope === "worldwide"
          ? "Worldwide 또는 어디서나 지원 가능한 Remote 범위가 명시되었습니다."
          : findSnippet(original, "korea"),
      source: remoteScope === "worldwide" ? "metadata" : "location",
    });
  } else if (eligibleFromKorea === "likely") {
    score += 22;
    addEvidence(evidence, {
      field: "eligibleFromKorea",
      effect: 22,
      text: "APAC 또는 Asia 범위의 Remote 신호가 있습니다.",
      source: "location",
    });
  } else if (eligibleFromKorea === "unknown") {
    score += 5;
  } else {
    score -= 40;
    addEvidence(evidence, {
      field: "eligibleFromKorea",
      effect: -40,
      text: "거주 지역 제한 또는 출근 요구가 감지되었습니다.",
      source: "location",
    });
  }

  const asyncScore: Record<AsyncLevel, number> = {
    explicit: 25,
    strong: 20,
    weak: 8,
    synchronous: -8,
    unknown: 0,
  };
  score += asyncScore[asyncResult.level];
  if (asyncResult.level !== "unknown") {
    const term = asyncResult.positives[0] ?? asyncResult.negatives[0] ?? "async";
    addEvidence(evidence, {
      field: "asyncLevel",
      effect: asyncScore[asyncResult.level],
      text: findSnippet(original, term),
      source: "job-description",
    });
  }

  const roleMatch = profile.roles.strong.find((role) => title.includes(role));
  const frontendLike = /\bfront[- ]?end\b|\bproduct engineer\b|\bgraphics engineer\b|\bcreative developer\b|\bvisualization engineer\b/.test(
    title,
  );
  const backendDominant = /\bback[- ]?end\b/.test(title) && !/\bfront[- ]?end\b/.test(title);
  if (roleMatch || frontendLike) {
    score += 15;
    addEvidence(evidence, {
      field: "role",
      effect: 15,
      text: input.title,
      source: "title",
    });
  } else if (/\bproduct\b/.test(title)) {
    score += 8;
  }
  if (backendDominant) {
    score -= 10;
    addEvidence(evidence, {
      field: "role",
      effect: -10,
      text: "Backend 중심 역할로 보입니다.",
      source: "title",
    });
  }

  if (skills.length >= 2) {
    score += 15;
    addEvidence(evidence, {
      field: "skills",
      effect: 15,
      text: skills.join(" · "),
      source: "job-description",
    });
  } else if (skills.length === 1) {
    score += 10;
    addEvidence(evidence, {
      field: "skills",
      effect: 10,
      text: skills[0] ?? "Graphics skill",
      source: "job-description",
    });
  }

  const ownership = matchFirst(text, OWNERSHIP_PATTERNS);
  if (ownership?.[0]) {
    score += 10;
    addEvidence(evidence, {
      field: "ownership",
      effect: 10,
      text: findSnippet(original, ownership[0]),
      source: "job-description",
    });
  }

  const compensation = matchFirst(text, COMPENSATION_PATTERNS);
  if (compensation?.[0]) {
    score += 5;
    addEvidence(evidence, {
      field: "compensation",
      effect: 5,
      text: findSnippet(original, compensation[0]),
      source: "job-description",
    });
  }

  if ((requiredOverlapHours ?? 0) >= 4 && /\b(?:pst|pdt|pt)\b/i.test(text)) {
    score -= 15;
    addEvidence(evidence, {
      field: "timezoneOverlap",
      effect: -15,
      text: `${requiredTimezone ?? "PT"} 기준 ${requiredOverlapHours}시간 이상 중첩 요구`,
      source: "job-description",
    });
  }
  if (/\bdaily stand[- ]?up\b/.test(text)) {
    score -= 8;
    addEvidence(evidence, {
      field: "syncRisk",
      effect: -8,
      text: findSnippet(original, "daily stand"),
      source: "job-description",
    });
  }
  if (/\bfrequent (?:customer|client) (?:video )?(?:calls|meetings)\b/.test(text)) {
    score -= 8;
    addEvidence(evidence, {
      field: "syncRisk",
      effect: -8,
      text: "빈번한 고객 화상회의 신호가 있습니다.",
      source: "job-description",
    });
  }

  const knownSignals = [
    workplaceType !== "unknown",
    remoteScope !== "unknown",
    eligibleFromKorea !== "unknown",
    asyncResult.level !== "unknown",
    skills.length > 0,
    Boolean(roleMatch || frontendLike),
  ].filter(Boolean).length;
  const confidence = Math.min(0.98, 0.32 + knownSignals * 0.1 + evidence.length * 0.025);

  return {
    workplaceType,
    remoteScope,
    eligibleFromKorea,
    asyncLevel: asyncResult.level,
    requiredTimezone,
    requiredOverlapHours,
    skills,
    score: Math.max(0, Math.min(100, Math.round(score))),
    confidence: Number(confidence.toFixed(2)),
    evidence,
  };
}
