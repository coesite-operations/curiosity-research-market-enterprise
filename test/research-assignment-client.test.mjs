import assert from "node:assert/strict";
import test from "node:test";
import { extractRmnPart, parseA2aMessage, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";

const A2A_JSON_OBJECT_KIND = "rsc-quiescent.a2a-json";
const semanticBytes = (value) => identifyJsonSemanticContent({ objectKind: A2A_JSON_OBJECT_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
const decodeSemantic = (bytes) => admitJsonSemanticContent({ bytes, objectKind: A2A_JSON_OBJECT_KIND }).value;
import { ACTOR, contentId } from "../src/market.mjs";
import { CHANNEL, PURPOSE, createResearchAssignmentClient, loadResearchAssignmentBinding } from "../src/research-assignment-client.mjs";

const CARD = "ni:///sha-256;Exvm7bRpjR-DOAgjwdT2L-RIvNY7z8YZawDxznzXWGE";
function exact(body) { return { id: contentId(body), ...body }; }
function assignment() { return exact({ type: "ResearchAssignment", buyer: CHANNEL, market: ACTOR, question: "What relations reproduce this outcome?", motivatingCandidates: [], maxPriceMicros: 5000, accountingUnit: "USD-micros", paymentCommitment: `ni:///sha-256;${"A".repeat(43)}`, intendedUses: ["notebooklm-transformation", "public-youtube-release"], permittedBuyers: [CHANNEL], acceptance: { minimumSources: 3, claimWarrants: true, uncertainty: true, correctionIdentity: true, requiredReuseRights: ["notebooklm-transformation", "public-youtube-release"] }, deliveryBy: "2096-07-23T00:00:00.000Z", authorityWithheld: ["research-findings"], admittedAt: "2096-07-22T00:00:00.000Z" }); }
const ASSIGNMENT = assignment().id;
function response(result) { return { agentCard: { signatures: [{}] }, inputNi: `ni:///sha-256;${"B".repeat(43)}`, outputNi: `ni:///sha-256;${"C".repeat(43)}`, result: { status: { message: { parts: [rmnPart(semanticBytes(["research-assignment-delivery-result", result]), "result.rmn.cbor")] } } } }; }

test("a pinned signed channel delivery authenticates one exact assignment", async () => {
  let observed;
  const client = createResearchAssignmentClient({ agentUrl: "https://channel.invalid/.well-known/agent-card.json", expectedAgentCardIdentity: CARD, cardEvidence: () => ({ card: CARD }), send: async ({ message }) => {
    observed = decodeSemantic(extractRmnPart(parseA2aMessage(message).parts).bytes)[1];
    const object = assignment();
    const delivery = exact({ type: "Accept", actor: CHANNEL, target: ACTOR, inReplyTo: observed.id, object });
    return response(exact({ type: "ResearchAssignmentDeliveryResult", provider: CHANNEL, customer: ACTOR, request: observed.id, assignment: ASSIGNMENT, purpose: PURPOSE, disposition: "delivered", delivery, externalEffects: [] }));
  } });
  const delivery = await client.requestAssignment(ASSIGNMENT);
  assert.equal(observed.assignment, ASSIGNMENT);
  assert.equal(await client.verifyDelivery(delivery), true);
  assert.equal(client.evidenceFor(delivery).agentCardIdentity, CARD);
});

test("foreign card identity, refusal, and external effects never authenticate", async () => {
  const foreign = createResearchAssignmentClient({ agentUrl: "https://channel.invalid/.well-known/agent-card.json", expectedAgentCardIdentity: CARD, cardEvidence: () => ({ card: `ni:///sha-256;${"D".repeat(43)}` }), send: async () => response({}) });
  await assert.rejects(() => foreign.requestAssignment(ASSIGNMENT), /identity does not match/u);
  const refused = createResearchAssignmentClient({ agentUrl: "https://channel.invalid/.well-known/agent-card.json", expectedAgentCardIdentity: CARD, cardEvidence: () => ({ card: CARD }), send: async ({ message }) => { const request = decodeSemantic(extractRmnPart(parseA2aMessage(message).parts).bytes)[1]; return response(exact({ type: "ResearchAssignmentDeliveryRefusal", provider: CHANNEL, customer: ACTOR, request: request.id, assignment: ASSIGNMENT, purpose: PURPOSE, disposition: "refused", code: "research-assignment-not-admitted", externalEffects: [] })); } });
  await assert.rejects(() => refused.requestAssignment(ASSIGNMENT), /not-admitted/u);
  const effect = createResearchAssignmentClient({ agentUrl: "https://channel.invalid/.well-known/agent-card.json", expectedAgentCardIdentity: CARD, cardEvidence: () => ({ card: CARD }), send: async ({ message }) => { const request = decodeSemantic(extractRmnPart(parseA2aMessage(message).parts).bytes)[1]; return response(exact({ type: "ResearchAssignmentDeliveryResult", provider: CHANNEL, customer: ACTOR, request: request.id, assignment: ASSIGNMENT, purpose: PURPOSE, disposition: "delivered", externalEffects: ["wrote-market"] })); } });
  await assert.rejects(() => effect.requestAssignment(ASSIGNMENT), /effect outside/u);
});

test("the live market binding pins the channel card and exact delivery law", () => {
  const binding = loadResearchAssignmentBinding();
  assert.equal(binding.agentCardIdentity, CARD);
  assert.equal(binding.contract, "ni:///sha-256;7mvCS783rB0rrZxRFYfWtTVcPVebnVPs0WneVaWmXNw");
  assert.equal(binding.customer, ACTOR);
  assert.equal(binding.provider, CHANNEL);
});
