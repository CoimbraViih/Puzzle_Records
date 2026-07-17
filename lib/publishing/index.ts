import type { PublishingProvider } from "./types";
import { ZernioProvider } from "./zernio";

export function getPublishingProvider(): PublishingProvider {
  return new ZernioProvider();
}

export type {
  PublishInput,
  PublishResult,
  PublishingProvider,
  PostMetrics,
} from "./types";
export { PublishError, PublishPendingError } from "./types";
// Descoberta de contas conectadas no Zernio — usado só por /admin (aba Contas sociais)
// (não faz parte da interface PublishingProvider, que é sobre publicar/medir,
// não sobre gerenciar contas do fornecedor).
export { listZernioAccounts, type ZernioAccount } from "./zernio";
