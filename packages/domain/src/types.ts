export type WorkplaceType = "remote" | "hybrid" | "onsite" | "unknown";
export type RemoteScope =
  | "worldwide"
  | "apac"
  | "country-list"
  | "region-limited"
  | "unknown";
export type Eligibility = "yes" | "likely" | "unknown" | "no";
export type AsyncLevel =
  | "explicit"
  | "strong"
  | "weak"
  | "synchronous"
  | "unknown";

export interface Evidence {
  field: string;
  effect: number;
  text: string;
  source: "job-description" | "title" | "location" | "metadata";
}

export interface TargetProfile {
  roles: {
    strong: string[];
  };
  skills: {
    strong: string[];
  };
  asyncPositive: string[];
  asyncNegative: string[];
}

export interface ClassificationInput {
  title: string;
  descriptionText: string;
  locationText?: string | null;
  employmentType?: string | null;
}

export interface ClassificationResult {
  workplaceType: WorkplaceType;
  remoteScope: RemoteScope;
  eligibleFromKorea: Eligibility;
  asyncLevel: AsyncLevel;
  requiredTimezone: string | null;
  requiredOverlapHours: number | null;
  skills: string[];
  score: number;
  confidence: number;
  evidence: Evidence[];
}

export const defaultTargetProfile: TargetProfile = {
  roles: {
    strong: [
      "frontend engineer",
      "front-end engineer",
      "product engineer",
      "graphics engineer",
      "creative developer",
      "visualization engineer",
      "webgl engineer",
      "webgpu engineer",
    ],
  },
  skills: {
    strong: [
      "three.js",
      "threejs",
      "webgl",
      "webgpu",
      "glsl",
      "canvas",
      "svg",
      "pixijs",
      "pixi.js",
      "babylon.js",
      "visualization",
    ],
  },
  asyncPositive: [
    "async-first",
    "asynchronous communication",
    "asynchronous written communication",
    "no core hours",
    "documentation-first",
    "written communication",
    "flexible schedule",
    "work whenever",
  ],
  asyncNegative: [
    "daily stand-up",
    "daily standup",
    "core collaboration hours",
    "must overlap",
    "frequent zoom calls",
    "frequent video calls",
  ],
};
