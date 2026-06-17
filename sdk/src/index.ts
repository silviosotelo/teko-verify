/**
 * @teko/verify-sdk — SDK server-side de Teko Verify (KYC / identidad).
 *
 *   import { TekoClient, verifyWebhookSignature } from "@teko/verify-sdk";
 *
 *   const teko = new TekoClient({ baseUrl, apiKey });
 *   const { verificationUrl } = await teko.createSession({ externalRef: "user-42" });
 *   // redirigí al titular a verificationUrl (flujo hosted)
 *
 *   // en el endpoint del webhook (con el cuerpo CRUDO):
 *   if (!verifyWebhookSignature(rawBody, req.headers, secret)) return res.sendStatus(401);
 */
export { TekoClient, TekoApiError } from "./client";
export type { TekoClientOptions } from "./client";
export {
  verifyWebhookSignature,
  verifySignature,
  signPayload,
  REPLAY_WINDOW_SEC,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
} from "./signature";
export type { HeadersLike, VerifyWebhookOptions } from "./signature";
export type {
  LoA,
  SessionState,
  DecisionVerdict,
  DocumentType,
  SessionResult,
  EvidenceMeta,
  CreateSessionOptions,
  CreateSessionResponse,
  SessionStatusResponse,
  ListSessionsResponse,
  ListSessionsOptions,
  DeleteSessionResponse,
  WebhookEvent,
  WebhookEventPayload,
} from "./types";
