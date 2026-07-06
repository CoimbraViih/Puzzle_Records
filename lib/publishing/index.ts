import type { PublishingProvider } from "./types";
import { ZernioProvider } from "./zernio";

export function getPublishingProvider(): PublishingProvider {
  return new ZernioProvider();
}

export type { PublishInput, PublishResult, PublishingProvider } from "./types";
export { PublishError } from "./types";
