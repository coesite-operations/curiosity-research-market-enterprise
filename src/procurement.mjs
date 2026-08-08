import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { querySettlementRecords } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
import {
  ACTOR,
  NODE_ROOT,
  admitAssignment,
  admitAwardSettlement,
  clearOffers,
  contentId,
} from "./market.mjs";
import researchAssignmentFromBinding from "./research-assignment-client.mjs";
import analyticsCuriosityFromBinding from "./analytics-curiosity-client.mjs";
import { createSupplyOfferClient } from "./supply-offer-client.mjs";

const CHANNEL = "urn:ame:youtube-channel-enterprise";
const DESK = "urn:ame:relational-orientation-research-desk";

function exact(value) {
  if (!value || typeof value !== "object") return false;
  const { id, ...body } = value;
  return id === contentId(body);
}

export function commitmentBody(assignment) {
  return {
    type: "SamePrincipalResearchBudgetCommitment",
    payer: CHANNEL,
    market: ACTOR,
    question: assignment.question,
    maxPriceMicros: assignment.maxPriceMicros,
    accountingUnit: assignment.accountingUnit,
    intendedUses: assignment.intendedUses,
    deliveryBy: assignment.deliveryBy,
  };
}

export function commitmentFor(assignment) {
  return identifyJsonSemanticContent({
    objectKind: "emsweb.curiosity-research.same-principal-budget-commitment",
    value: commitmentBody(assignment),
    witnessRoot: EMPTY_WITNESS_ROOT,
  }).token;
}

function account() {
  return JSON.parse(readFileSync(join(NODE_ROOT, "content/evm/accounts/eip155-31337.json"), "utf8")).account.caip10;
}

function delivery(settled) {
  const body = { type: "Accept", actor: ACTOR, target: CHANNEL, object: settled };
  return { id: contentId(body), ...body };
}

export async function procureAssignment(assignmentId, options = {}) {
  const at = options.at ?? new Date().toISOString();
  const dataRoot = resolve(options.dataRoot ?? join(NODE_ROOT, "data"));
  const common = {
    at,
    dataRoot,
    runtimeRoot: resolve(options.runtimeRoot ?? join(dataRoot, "runtime/award-locks")),
    settlement: options.settlement ?? account(),
    witnessJournalAgentUrl: options.witnessJournalAgentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT,
  };
  const assignmentClient = options.assignmentClient ?? researchAssignmentFromBinding();
  const candidateClient = options.candidateClient ?? analyticsCuriosityFromBinding();
  const offerClient = options.offerClient ?? createSupplyOfferClient();
  const assignmentDelivery = await assignmentClient.requestAssignment(assignmentId);
  const assignment = assignmentDelivery.object;
  if ((await assignmentClient.verifyDelivery(assignmentDelivery)) !== true
    || assignment.paymentCommitment !== commitmentFor(assignment)) {
    throw new TypeError("procurement requires the authenticated same-principal assignment commitment");
  }
  const candidateDeliveries = [];
  for (const candidate of assignment.motivatingCandidates ?? []) candidateDeliveries.push(await candidateClient.requestCandidate(candidate));
  if (!(await Promise.all(candidateDeliveries.map((value) => candidateClient.verifyDelivery(value)))).every(Boolean)) throw new TypeError("procurement lacks an authenticated motivating curiosity delivery");
  const admission = await admitAssignment({ delivery: assignmentDelivery, candidateDeliveries }, {
    ...common,
    verifyDelivery: (value) => value === assignmentDelivery ? assignmentClient.verifyDelivery(value) : candidateClient.verifyDelivery(value),
    verifyCommitment: async () => assignment.paymentCommitment === commitmentFor(assignment),
  });

  const settledRows = (await querySettlementRecords("curiosity-research.settled-award"))
    .filter((row) => row.assignmentAdmission === admission.id);
  if (settledRows.length) {
    const rows = settledRows;
    if (rows.some((row) => !exact(row)) || new Set(rows.map((row) => row.id)).size !== 1) {
      throw new TypeError("procurement settled-award ledger conflicts");
    }
    return delivery(rows[0]);
  }

  const offerDelivery = await offerClient.request(admission.id);
  if ((await offerClient.verify(offerDelivery)) !== true) {
    throw new TypeError("procurement lacks the desk's authenticated offer");
  }
  let award = (await querySettlementRecords("curiosity-research.award"))
    .find((row) => row.assignmentAdmission === admission.id);
  if (!award) {
    award = await clearOffers({ assignmentAdmission: admission, offerDeliveries: [offerDelivery] }, {
      ...common,
      verifyDelivery: (value) => offerClient.verify(value),
    });
  }
  if (!exact(award) || award.provider !== DESK) throw new TypeError("procurement award is not exact");

  const receiptBody = {
    type: "SamePrincipalResearchSettlementReceipt",
    payer: CHANNEL,
    payee: DESK,
    award: award.id,
    researchOffer: award.researchOffer,
    amountMicros: award.askMicros,
    accountingUnit: award.accountingUnit,
    cashSettlementRequired: false,
    legalBodyRelation: "same-principal",
    status: "settled-internal-cost-allocation",
    settledAt: at,
  };
  const receipt = { id: contentId(receiptBody), ...receiptBody };
  const settled = await admitAwardSettlement({ award, settlementReceipt: receipt }, {
    ...common,
    verifySettlement: async (candidateAward, candidateReceipt) => exact(candidateReceipt)
      && candidateReceipt.award === candidateAward.id
      && candidateReceipt.cashSettlementRequired === false
      && candidateReceipt.legalBodyRelation === "same-principal"
      && candidateReceipt.status === "settled-internal-cost-allocation",
  });
  return delivery(settled);
}

export function validateProcurementRequest(request) {
  return exact(request)
    && request.type === "RelationalResearchProcurementRequest"
    && request.customer === CHANNEL
    && request.provider === ACTOR
    && /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(request.assignment ?? "");
}

export function procurementResult(request, marketDelivery) {
  const body = {
    type: "RelationalResearchProcurementResult",
    provider: ACTOR,
    customer: CHANNEL,
    request: request.id,
    assignment: request.assignment,
    disposition: "settled",
    delivery: marketDelivery,
    externalEffects: ["same-principal-internal-cost-allocation"],
  };
  return { id: contentId(body), ...body };
}
