import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { a2aResultParts, sendRmnTask } from "@red-cup-engineering/a2a-rmn-task-client-service";
import { agentCardSignatureEvidence } from "@red-cup-engineering/a2a-agent-card-discovery-service";
import { extractRmnPart, userRmnMessage } from "@red-cup-engineering/a2a-rmn-part-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
const A2A_CARRIER_KIND = "rsc-quiescent.a2a-json";
const semanticBytes = (value) => identifyJsonSemanticContent({ objectKind: A2A_CARRIER_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
const decodeSemantic = (bytes) => admitJsonSemanticContent({ bytes, objectKind: A2A_CARRIER_KIND }).value;
import { ACTOR, contentId } from "./market.mjs";

export const CHANNEL = "urn:ame:youtube-channel-enterprise";
export const PURPOSE = "research-market-clearing";
const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const RECORD = /^urn:sha256:[a-f0-9]{64}$/u;
function exact(value) { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const { id, ...body } = value; return id === contentId(body); }

export function loadResearchAssignmentBinding(path = new URL("../content/config/research-assignment-provider.json", import.meta.url)) {
  const binding = JSON.parse(readFileSync(path, "utf8"));
  if (binding?.type !== "YouTubeChannelResearchAssignmentProviderBinding"
    || binding.status !== "active"
    || binding.customer !== ACTOR
    || binding.provider !== CHANNEL
    || binding.purpose !== PURPOSE
    || typeof binding.agentUrl !== "string"
    || !binding.agentUrl.endsWith("/.well-known/agent-card.json")
    || !NI.test(binding.agentCardIdentity ?? "")) throw new TypeError("channel research-assignment binding is not active and exact");
  return binding;
}

export function createResearchAssignmentClient({ agentUrl, expectedAgentCardIdentity, send = sendRmnTask, cardEvidence = agentCardSignatureEvidence, timeoutMs = 120_000 } = {}) {
  if (typeof agentUrl !== "string" || !agentUrl.endsWith("/.well-known/agent-card.json") || !NI.test(expectedAgentCardIdentity ?? "")) throw new TypeError("research-assignment client requires a standard signed Agent Card binding");
  const authenticated = new WeakMap();
  return Object.freeze({
    async requestAssignment(assignment) {
      if (!RECORD.test(assignment ?? "")) throw new TypeError("research-assignment delivery request requires one content ID");
      const body = { type: "ResearchAssignmentDeliveryRequest", customer: ACTOR, provider: CHANNEL, assignment, purpose: PURPOSE };
      const request = { id: contentId(body), ...body };
      const message = userRmnMessage(semanticBytes(["research-assignment-delivery-request", request]), "research-assignment-delivery-request.rmn.cbor", randomUUID());
      const exchange = await send({ agentUrl, message, requireSignature: true, signal: AbortSignal.timeout(timeoutMs) });
      const identity = cardEvidence(exchange.agentCard).card;
      if (identity !== expectedAgentCardIdentity) throw new TypeError("channel research-assignment Agent Card identity does not match the contracted buyer");
      const output = extractRmnPart(a2aResultParts(exchange.result));
      const term = decodeSemantic(output.bytes);
      if (!semanticBytes(term).equals(output.bytes) || term?.[0] !== "research-assignment-delivery-result" || term.length !== 2) throw new TypeError("channel returned noncanonical or foreign research-assignment RMN");
      const result = term[1];
      if (!exact(result) || result.provider !== CHANNEL || result.customer !== ACTOR || result.request !== request.id || result.assignment !== assignment || result.purpose !== PURPOSE) throw new TypeError("channel result does not bind the exact assignment request");
      if (!Array.isArray(result.externalEffects) || result.externalEffects.length !== 0) throw new TypeError("channel result claims an effect outside assignment delivery");
      if (result.disposition === "refused") throw Object.assign(new Error(`channel refused assignment delivery: ${result.code ?? "unspecified"}`), { code: result.code, result });
      const delivery = result.delivery;
      if (result.disposition !== "delivered" || !exact(delivery) || delivery.type !== "Accept" || delivery.actor !== CHANNEL || delivery.target !== ACTOR || delivery.inReplyTo !== request.id || !exact(delivery.object) || delivery.object.id !== assignment || delivery.object.type !== "ResearchAssignment" || delivery.object.buyer !== CHANNEL || delivery.object.market !== ACTOR) throw new TypeError("channel result lacks the exact research-assignment delivery");
      authenticated.set(delivery, { request: request.id, assignment, agentCardIdentity: identity, inputNi: exchange.inputNi, outputNi: exchange.outputNi });
      return delivery;
    },
    async verifyDelivery(delivery) {
      const evidence = authenticated.get(delivery);
      return evidence?.assignment === delivery?.object?.id && evidence.agentCardIdentity === expectedAgentCardIdentity;
    },
    evidenceFor(delivery) { const evidence = authenticated.get(delivery); return evidence ? { ...evidence } : null; },
  });
}

export default function researchAssignmentFromBinding() {
  const binding = loadResearchAssignmentBinding();
  return createResearchAssignmentClient({ agentUrl: binding.agentUrl, expectedAgentCardIdentity: binding.agentCardIdentity });
}
