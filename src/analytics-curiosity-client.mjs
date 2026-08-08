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

export const BROKER = "urn:ame:channel-analytics-interpretation-broker";
export const PURPOSE = "research-assignment-motivation-verification";
const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const RECORD = /^urn:sha256:[a-f0-9]{64}$/u;
function exact(value) { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const { id, ...body } = value; return id === contentId(body); }

export function loadAnalyticsCuriosityBinding(path = new URL("../content/config/analytics-curiosity-provider.json", import.meta.url)) {
  const binding = JSON.parse(readFileSync(path, "utf8"));
  if (binding?.type !== "AnalyticsCuriosityOfferProviderBinding"
    || binding.status !== "active"
    || binding.customer !== ACTOR
    || binding.provider !== BROKER
    || binding.purpose !== PURPOSE
    || typeof binding.agentUrl !== "string"
    || !binding.agentUrl.endsWith("/.well-known/agent-card.json")
    || !NI.test(binding.agentCardIdentity ?? "")
    || !NI.test(binding.agentCardSignature ?? "")
    || !NI.test(binding.contract ?? "")) throw new TypeError("analytics curiosity provider binding is not active and exact");
  return binding;
}

export function createAnalyticsCuriosityClient({ binding = loadAnalyticsCuriosityBinding(), send = sendRmnTask, cardEvidence = agentCardSignatureEvidence, timeoutMs = 30_000 } = {}) {
  const authenticated = new WeakSet();
  return Object.freeze({
    async requestCandidate(candidate) {
      if (!RECORD.test(candidate ?? "")) throw new TypeError("analytics curiosity pickup requires one candidate content ID");
      const body = { type: "AnalyticsCuriosityOfferPickupRequest", requester: ACTOR, broker: BROKER, candidate };
      const request = { id: contentId(body), ...body };
      const message = userRmnMessage(semanticBytes(["analytics-curiosity-offer-pickup-request", request]), "analytics-curiosity-offer-pickup-request.rmn.cbor", randomUUID());
      const exchange = await send({ agentUrl: binding.agentUrl, message, requireSignature: true, signal: AbortSignal.timeout(timeoutMs) });
      const evidence = cardEvidence(exchange.agentCard);
      if (evidence.card !== binding.agentCardIdentity || evidence.signature !== binding.agentCardSignature) throw new TypeError("analytics curiosity Agent Card changed");
      const output = extractRmnPart(a2aResultParts(exchange.result));
      const term = decodeSemantic(output.bytes);
      if (!semanticBytes(term).equals(output.bytes) || term?.[0] !== "analytics-curiosity-offer-pickup-result" || term.length !== 2) throw new TypeError("analytics broker returned foreign or noncanonical curiosity RMN");
      const result = term[1];
      if (result?.provider !== BROKER || result.request !== request.id) throw new TypeError("analytics curiosity result does not bind the exact request");
      if (result.disposition === "refused") throw Object.assign(new Error(`analytics broker refused curiosity pickup: ${result.code ?? "unspecified"}`), { code: result.code, result });
      const offer = result.offer;
      if (result.disposition !== "delivered" || result.candidate !== candidate || !exact(offer) || offer.type !== "Offer" || offer.actor !== BROKER || !exact(offer.object) || offer.object.id !== candidate || offer.object.type !== "CuriosityCandidate" || offer.object.evidenceStatus !== "demand-signal-not-research-evidence" || offer.object.bidStatus !== "not-a-bid" || offer.object.spendingAuthority !== "none") throw new TypeError("analytics curiosity delivery is not the exact non-evidentiary candidate offer");
      authenticated.add(offer);
      return offer;
    },
    verifyDelivery(delivery) { return authenticated.has(delivery); },
  });
}

export default function analyticsCuriosityFromBinding() { return createAnalyticsCuriosityClient(); }
