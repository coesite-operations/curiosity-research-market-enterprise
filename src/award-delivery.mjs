import { join, resolve } from "node:path";
import { querySettlementRecords } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import { ACTOR, NODE_ROOT, contentId } from "./market.mjs";

export const CUSTOMER = "urn:ame:relational-orientation-research-desk";
export const SETTLED_AWARD_CATEGORY = "curiosity-research.settled-award";
export const PURPOSE = "research-packet-production";
const RECORD = /^urn:sha256:[a-f0-9]{64}$/u;

function exact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { id, ...body } = value;
  return id === contentId(body);
}

function refusal(request, code) {
  const body = {
    type: "SettledResearchAwardDeliveryRefusal",
    provider: ACTOR,
    customer: request?.customer ?? null,
    request: request?.id ?? null,
    settledAward: request?.settledAward ?? null,
    purpose: request?.purpose ?? null,
    disposition: "refused",
    code,
    externalEffects: [],
  };
  return { id: contentId(body), ...body };
}

export async function deliverSettledResearchAward(request, options = {}) {
  if (!exact(request)
    || request.type !== "SettledResearchAwardDeliveryRequest"
    || request.provider !== ACTOR
    || request.customer !== CUSTOMER
    || !RECORD.test(request.settledAward ?? "")
    || request.purpose !== PURPOSE) {
    return refusal(request, "invalid-settled-award-delivery-request");
  }
  const dataRoot = resolve(options.dataRoot ?? join(NODE_ROOT, "data"));
  const records = (await querySettlementRecords(SETTLED_AWARD_CATEGORY)).filter((row) => row.id === request.settledAward);
  if (records.length === 0) return refusal(request, "settled-award-not-admitted");
  const awards = records;
  if (awards.some((award) => !exact(award)) || new Set(awards.map((award) => award.id)).size !== 1) return refusal(request, "settled-award-ledger-conflict");
  const award = awards[0];
  if (award.type !== "SettledResearchAward"
    || award.market !== ACTOR
    || award.provider !== CUSTOMER
    || award.status !== "funded-research-not-delivered"
    || !Array.isArray(award.authorityWithheld)
    || !["research-findings", "source-truth", "publication-authority"].every((authority) => award.authorityWithheld.includes(authority))) {
    return refusal(request, "settled-award-not-deliverable");
  }
  const deliveryBody = { type: "Accept", actor: ACTOR, target: CUSTOMER, inReplyTo: request.id, object: award };
  const delivery = { id: contentId(deliveryBody), ...deliveryBody };
  const body = {
    type: "SettledResearchAwardDeliveryResult",
    provider: ACTOR,
    customer: CUSTOMER,
    request: request.id,
    settledAward: award.id,
    purpose: PURPOSE,
    disposition: "delivered",
    delivery,
    externalEffects: [],
  };
  return { id: contentId(body), ...body };
}
