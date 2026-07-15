import type { CutProProvider } from "./types";
import { CutProClient } from "./client";

export function getCutProProvider(): CutProProvider {
  return new CutProClient();
}

export type {
  CutProTemplate,
  AnalyzeVideoResult,
  UploadHandle,
  ClippingSubmission,
  Clip,
  RenderStatus,
  CutProBalance,
  CutProProvider,
} from "./types";
export { CutProError, CutProRateLimitError } from "./types";
