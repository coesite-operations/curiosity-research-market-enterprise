import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { a2aResultParts, sendRmnTask } from "@red-cup-engineering/a2a-rmn-task-client-service";
import { serveContractedAgent } from "@red-cup-engineering/a2a-contracted-agent-service";
import { ephemeralAgentCardSigning } from "@red-cup-engineering/a2a-agent-card-key-service/testing";
import { extractRmnPart, userRmnMessage } from "@red-cup-engineering/a2a-rmn-part-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";

const A2A_JSON_OBJECT_KIND = "rsc-quiescent.a2a-json";
const semanticBytes = (value) => identifyJsonSemanticContent({ objectKind: A2A_JSON_OBJECT_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
const decodeSemantic = (bytes) => admitJsonSemanticContent({ bytes, objectKind: A2A_JSON_OBJECT_KIND }).value;
import { recordSettlementRecord } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-rdf-projection-service/test-provider";
import { CUSTOMER, PURPOSE, SETTLED_AWARD_CATEGORY, deliverSettledResearchAward } from "../src/award-delivery.mjs";
import { ACTOR, contentId } from "../src/market.mjs";

const NOW = "2096-07-22T12:00:00.000Z";
const SETTLEMENT = "eip155:31337:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function exact(body) { return { id: contentId(body), ...body }; }
function award() {
  return exact({
    type: "SettledResearchAward",
    market: ACTOR,
    award: `urn:sha256:${"1".repeat(64)}`,
    buyer: "urn:ame:youtube-channel-enterprise",
    provider: CUSTOMER,
    assignmentAdmission: `urn:sha256:${"2".repeat(64)}`,
    researchOffer: `urn:sha256:${"3".repeat(64)}`,
    question: "How do institutions reproduce outcomes?",
    intendedUses: ["notebooklm-transformation", "public-youtube-release", "koios-editorial-reuse"],
    permittedBuyers: ["urn:ame:youtube-channel-enterprise", "urn:ame:koios-news"],
    acceptance: { minimumSources: 3, claimWarrants: true, uncertainty: true, correctionIdentity: true, requiredReuseRights: ["notebooklm-transformation", "public-youtube-release", "koios-editorial-reuse"] },
    deliveryBy: "2096-07-23T00:00:00.000Z",
    settlementReceipt: `urn:sha256:${"4".repeat(64)}`,
    status: "funded-research-not-delivered",
    authorityWithheld: ["research-findings", "source-truth", "publication-authority"],
    admittedAt: NOW,
  });
}
function request(id) { return exact({ type: "SettledResearchAwardDeliveryRequest", customer: CUSTOMER, provider: ACTOR, settledAward: id, purpose: PURPOSE }); }
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "settled-award-delivery-"));
  const dataRoot = join(root, "data");
  const witnessJournal = await startWitnessJournalProviderProcess();
  const value = award();
  t.after(async () => { await witnessJournal.close(); rmSync(root, { recursive: true, force: true }); });
  await recordSettlementRecord({ agentUrl: witnessJournal.agentCardUrl, settlement: SETTLEMENT, actor: ACTOR, category: SETTLED_AWARD_CATEGORY, recordedAt: NOW, record: { ...value } });
  return { root, dataRoot, witnessJournal, value };
}
async function freePort() { const server = createServer(); await new Promise((accept) => server.listen(0, "127.0.0.1", accept)); const port = server.address().port; await new Promise((accept) => server.close(accept)); return port; }

test("deployed award delivery exposes only its signed read-only identity", () => {
  const activation = JSON.parse(readFileSync(new URL("../content/config/award-delivery-agent.json", import.meta.url), "utf8"));
  const jwks = JSON.parse(readFileSync(new URL("../content/agent-cards/settled-award-delivery-jwks.json", import.meta.url), "utf8"));
  const unit = readFileSync(new URL("../content/deployment/systemd-user/emsweb-curiosity-market-award-delivery-a2a.service", import.meta.url), "utf8");
  assert.equal(activation.status, "active");
  assert.equal(activation.agentCardIdentity, "ni:///sha-256;WkdtgBCjvSrB55ayPZt3NtTsv0_5MM6Y3ppGq0QVso0");
  assert.equal(jwks.keys[0].d, undefined);
  assert.match(unit, /^InaccessiblePaths=.*relational-orientation-research-desk$/mu);
  assert.match(unit, /^ReadWritePaths=.*curiosity-research-market-enterprise\/data\/a2a\/tasks$/mu);
});

test("one exact settled award is delivered only to its named provider", async (t) => {
  const { dataRoot, value } = await fixture(t);
  const demand = request(value.id);
  const first = deliverSettledResearchAward(demand, { dataRoot });
  assert.deepEqual(deliverSettledResearchAward(demand, { dataRoot }), first);
  assert.equal(first.disposition, "delivered");
  assert.equal(first.delivery.actor, ACTOR);
  assert.equal(first.delivery.target, CUSTOMER);
  assert.deepEqual(first.delivery.object, value);
  assert.deepEqual(first.externalEffects, []);
  assert.equal(deliverSettledResearchAward(request(`urn:sha256:${"0".repeat(64)}`), { dataRoot }).code, "settled-award-not-admitted");
});

test("foreign, widened, and ambient requests are refused", async (t) => {
  const { dataRoot, value, witnessJournal } = await fixture(t);
  const body = Object.fromEntries(Object.entries(request(value.id)).filter(([key]) => key !== "id"));
  assert.equal(deliverSettledResearchAward(exact({ ...body, customer: "urn:ame:foreign" }), { dataRoot }).code, "invalid-settled-award-delivery-request");
  assert.equal(deliverSettledResearchAward(exact({ ...body, purpose: "research-and-publication" }), { dataRoot }).code, "invalid-settled-award-delivery-request");
  assert.equal(deliverSettledResearchAward({ type: "ListSettledAwards" }, { dataRoot }).code, "invalid-settled-award-delivery-request");
});

test("the signed A2A face binds canonical request and exact settled award", async (t) => {
  const { dataRoot, value } = await fixture(t);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const root = resolve(new URL("..", import.meta.url).pathname);
  const prior = process.env.CURIOSITY_RESEARCH_MARKET_DATA_ROOT;
  process.env.CURIOSITY_RESEARCH_MARKET_DATA_ROOT = dataRoot;
  const running = await serveContractedAgent({ port, host: "127.0.0.1", baseUrl, agentCard: join(root, "content/agent-cards/settled-award-delivery.json"), executor: process.execPath, executorArgs: [join(root, "src/a2a-award-delivery-executor.mjs")], timeoutMs: 10000, ...ephemeralAgentCardSigning(baseUrl, "settled-award-delivery") });
  t.after(async () => { await new Promise((accept) => running.server.close(accept)); if (prior === undefined) delete process.env.CURIOSITY_RESEARCH_MARKET_DATA_ROOT; else process.env.CURIOSITY_RESEARCH_MARKET_DATA_ROOT = prior; });
  const demand = request(value.id);
  const message = userRmnMessage(semanticBytes(["settled-research-award-delivery-request", demand]), "settled-award-request.rmn.cbor");
  const exchange = await sendRmnTask({ agentUrl: `${baseUrl}/.well-known/agent-card.json`, message, requireSignature: true, signal: AbortSignal.timeout(10000) });
  const term = decodeSemantic(extractRmnPart(a2aResultParts(exchange.result)).bytes);
  assert.equal(term[0], "settled-research-award-delivery-result");
  assert.equal(term[1].request, demand.id);
  assert.equal(term[1].delivery.object.id, value.id);
  assert.equal(exchange.agentCard.signatures.length, 1);
});
