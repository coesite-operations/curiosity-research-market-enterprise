import { join, resolve } from "node:path";
import { querySettlementRecords } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import { ACTOR, NODE_ROOT, contentId } from "./market.mjs";

export const CUSTOMER = "urn:ame:relational-orientation-research-desk";
export const CATEGORY = "curiosity-research.assignment-admission";
export const PURPOSE = "research-supply-offer-formation";
const RECORD = /^urn:sha256:[a-f0-9]{64}$/u;
function exact(value) { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const { id, ...body } = value; return id === contentId(body); }
function refusal(request, code) { const body = { type: "ResearchAssignmentAdmissionDeliveryRefusal", provider: ACTOR, customer: request?.customer ?? null, request: request?.id ?? null, assignmentAdmission: request?.assignmentAdmission ?? null, purpose: request?.purpose ?? null, disposition: "refused", code, externalEffects: [] }; return { id: contentId(body), ...body }; }

export async function deliverResearchAssignmentAdmission(request, options = {}) {
  if (!exact(request) || request.type !== "ResearchAssignmentAdmissionDeliveryRequest" || request.provider !== ACTOR || request.customer !== CUSTOMER || !RECORD.test(request.assignmentAdmission ?? "") || request.purpose !== PURPOSE) return refusal(request, "invalid-assignment-admission-delivery-request");
  const rows = (await querySettlementRecords(CATEGORY)).filter((row) => row.id === request.assignmentAdmission);
  if (rows.length === 0) return refusal(request, "assignment-admission-not-admitted");
  const admissions = rows;
  if (admissions.some((row) => !exact(row)) || new Set(admissions.map((row) => row.id)).size !== 1) return refusal(request, "assignment-admission-ledger-conflict");
  const admission = admissions[0];
  if (admission.type !== "ResearchAssignmentAdmission" || admission.market !== ACTOR || !Number.isSafeInteger(admission.maxPriceMicros) || admission.maxPriceMicros <= 0 || admission.accountingUnit !== "USD-micros" || !Array.isArray(admission.intendedUses) || !Array.isArray(admission.permittedBuyers) || !Number.isInteger(admission.acceptance?.minimumSources)) return refusal(request, "assignment-admission-not-deliverable");
  const deliveryBody = { type: "Accept", actor: ACTOR, target: CUSTOMER, inReplyTo: request.id, object: admission };
  const delivery = { id: contentId(deliveryBody), ...deliveryBody };
  const body = { type: "ResearchAssignmentAdmissionDeliveryResult", provider: ACTOR, customer: CUSTOMER, request: request.id, assignmentAdmission: admission.id, purpose: PURPOSE, disposition: "delivered", delivery, externalEffects: [] };
  return { id: contentId(body), ...body };
}
