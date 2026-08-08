import assert from "node:assert/strict";
import test from "node:test";
import { extractRmnPart, parseA2aMessage, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";

const A2A_JSON_OBJECT_KIND = "rsc-quiescent.a2a-json";
const semanticBytes = (value) => identifyJsonSemanticContent({ objectKind: A2A_JSON_OBJECT_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
const decodeSemantic = (bytes) => admitJsonSemanticContent({ bytes, objectKind: A2A_JSON_OBJECT_KIND }).value;
import { ACTOR, contentId } from "../src/market.mjs";
import { BROKER, createAnalyticsCuriosityClient, loadAnalyticsCuriosityBinding } from "../src/analytics-curiosity-client.mjs";

const CARD = "ni:///sha-256;B5iNl2JoLtyOfc-VLAnNe_xDGMI0zuJC3rZCp7JrFmA";
const SIGNATURE = "ni:///sha-256;OpZRzHakKqIRIoT4OV_sFIjxhhDmbyNMN2hdPnr2ZfQ";
function exact(body) { return { id: contentId(body), ...body }; }
function candidate() { return exact({ type: "CuriosityCandidate", motivatingInterpretation: "urn:interpretation", question: "Which relation warrants follow-up?", whyItMayMatter: "It may discriminate among explanations.", permittedUses: ["consider-for-research-assignment"], evidenceStatus: "demand-signal-not-research-evidence", bidStatus: "not-a-bid", spendingAuthority: "none" }); }
function offer(object = candidate()) { return exact({ type: "Offer", actor: BROKER, object, published: "2096-07-21T12:00:00.000Z" }); }
function response(result) { return { agentCard: { signatures: [{}] }, inputNi: `ni:///sha-256;${"B".repeat(43)}`, outputNi: `ni:///sha-256;${"C".repeat(43)}`, result: { status: { message: { parts: [rmnPart(semanticBytes(["analytics-curiosity-offer-pickup-result", result]), "result.rmn.cbor")] } } } }; }

test("a pinned broker card delivers the exact offer enclosing a named candidate", async () => {
  const object = candidate(); let observed;
  const client = createAnalyticsCuriosityClient({ binding: { ...loadAnalyticsCuriosityBinding(), agentUrl: "https://broker.invalid/.well-known/agent-card.json" }, cardEvidence: () => ({ card: CARD, signature: SIGNATURE }), send: async ({ message }) => {
    observed = decodeSemantic(extractRmnPart(parseA2aMessage(message).parts).bytes)[1];
    return response({ type: "AnalyticsCuriosityOfferPickupResult", provider: BROKER, request: observed.id, candidate: object.id, disposition: "delivered", offer: offer(object) });
  } });
  const delivery = await client.requestCandidate(object.id);
  assert.equal(observed.requester, ACTOR);
  assert.equal(observed.candidate, object.id);
  assert.equal(delivery.object.id, object.id);
  assert.equal(client.verifyDelivery(delivery), true);
});

test("a changed card or a different candidate never authenticates", async () => {
  const object = candidate(), binding = { ...loadAnalyticsCuriosityBinding(), agentUrl: "https://broker.invalid/.well-known/agent-card.json" };
  const changed = createAnalyticsCuriosityClient({ binding, cardEvidence: () => ({ card: CARD, signature: `ni:///sha-256;${"D".repeat(43)}` }), send: async () => response({}) });
  await assert.rejects(() => changed.requestCandidate(object.id), /Agent Card changed/u);
  const mismatched = createAnalyticsCuriosityClient({ binding, cardEvidence: () => ({ card: CARD, signature: SIGNATURE }), send: async ({ message }) => { const request = decodeSemantic(extractRmnPart(parseA2aMessage(message).parts).bytes)[1]; const { id: _id, ...body } = object; const other = exact({ ...body, question: "A different question?" }); return response({ type: "AnalyticsCuriosityOfferPickupResult", provider: BROKER, request: request.id, candidate: object.id, disposition: "delivered", offer: offer(other) }); } });
  await assert.rejects(() => mismatched.requestCandidate(object.id), /exact non-evidentiary/u);
});

test("the live binding pins the broker card, signature, and delivery law", () => {
  const binding = loadAnalyticsCuriosityBinding();
  assert.equal(binding.agentCardIdentity, CARD);
  assert.equal(binding.agentCardSignature, SIGNATURE);
  assert.equal(binding.contract, "ni:///sha-256;2mPiVr1TKgqj9SMBOIgXVmedmukxTYGGyoEZv5in7xw");
});
