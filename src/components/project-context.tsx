"use client";

import { createContext, useContext } from "react";
import type { AssetLite } from "./ui";

export interface ProjectLite {
  id: string;
  slug: string;
  name: string;
  description: string;
  brief: string;
  status: string;
  budgetUsd: number;
  settings: {
    productUrl?: string;
    brandName?: string;
    brandPronunciation?: string;
    language?: string;
    palette?: Record<string, string>;
    verifiedClaims: string[];
    brandNotes?: string;
    voiceId?: string;
  };
}

export interface RunLite {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  spentUsd: number;
  preauthorizedUsd: number;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  progress: number;
  counts: Record<string, number>;
}

export interface SceneLite {
  id: string;
  storyboard: string;
  idx: number;
  title: string;
  durationS: number;
  aspect: string;
  prompt: string;
  narration: string;
  onScreenText: string;
  camera: string;
  constraints: string[];
  references: string[];
  tool: string;
  settings: Record<string, unknown>;
  status: "draft" | "generating" | "review" | "approved" | "rejected" | "failed";
  selectedAssetId: string | null;
  costUsd: number;
  notes: string;
  version: number;
}

export interface ApprovalLite {
  id: string;
  projectId: string;
  projectName?: string;
  runId: string | null;
  nodeId?: string;
  kind: "cost" | "creative";
  status: string;
  title: string;
  detail: string;
  amountUsd: number | null;
  amountKnown: boolean;
  requestedAt: number;
  previewAssetIds: string[];
}

export interface CostSummaryLite {
  actualKnownUsd: number;
  actualUnknownCount: number;
  estimateKnownUsd: number;
  estimateUnknownCount: number;
  reusedCount: number;
  tokensIn: number;
  tokensOut: number;
  apiCalls: number;
  byProvider: { provider: string; actualUsd: number; unknown: number; calls: number; units: string | null; quantity: number }[];
}

export interface AssetFull extends AssetLite {
  projectId: string;
  path: string;
  size: number;
  sha256: string;
  fps: number | null;
  metadata: Record<string, unknown>;
  parents: string[];
  provenance: Record<string, unknown>;
  nodeRunId: string | null;
  sceneId: string | null;
  version: number;
  createdAt: number;
}

export interface Overview {
  project: ProjectLite;
  workflows: { id: string; name: string; version: number; source: string; nodes: number; updatedAt: number }[];
  runs: RunLite[];
  scenes: SceneLite[];
  plans: { id: string; status: string; error: string | null; createdAt: number; finishedAt: number | null; costUsd: number | null; title: string | null; brief: string }[];
  assets: AssetFull[];
  assetCount: number;
  costs: CostSummaryLite;
  approvals: ApprovalLite[];
  exports: { name: string; size: number; modifiedAt: number }[];
}

export interface ProjectCtx {
  data: Overview | undefined;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

export const ProjectContext = createContext<ProjectCtx>({ data: undefined, error: null, loading: true, reload: async () => undefined });

export function useProject(): ProjectCtx {
  return useContext(ProjectContext);
}
