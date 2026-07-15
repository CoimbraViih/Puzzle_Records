import type { CutProProvider } from "./types";
import { CutProClient } from "./client";

export function getCutProProvider(): CutProProvider {
  return new CutProClient();
}

export type {
  CutProTemplate,
  UploadHandle,
  CompletedUpload,
  SubmissionStatus,
  ClippingSubmission,
  Clip,
  RenderJobStatus,
  RenderSubmission,
  RenderStatus,
  CutProBalance,
  CutProProvider,
} from "./types";
export { CutProError, CutProRateLimitError } from "./types";
