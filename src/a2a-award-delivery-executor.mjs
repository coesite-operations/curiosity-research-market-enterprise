#!/usr/bin/env node
import { resolve } from "node:path";
import { agentRmnMessage, extractRmnPart, parseA2aMessage } from "@red-cup-engineering/a2a-rmn-part-service";
import { admitJsonSemanticContent, EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
const A2A_CARRIER_KIND = "rsc-quiescent.a2a-json";
const semanticBytes = (value) => identifyJsonSemanticContent({ objectKind: A2A_CARRIER_KIND, value, witnessRoot: EMPTY_WITNESS_ROOT }).bytes;
const decodeSemantic = (bytes) => admitJsonSemanticContent({ bytes, objectKind: A2A_CARRIER_KIND }).value;
import { deliverSettledResearchAward } from "./award-delivery.mjs";

export async function executeAwardDeliveryMessage(message, options = {}) {
  const parsed = parseA2aMessage(message);
  const part = extractRmnPart(parsed.parts);
  const term = decodeSemantic(part.bytes);
  if (!semanticBytes(term).equals(part.bytes) || term?.[0] !== "settled-research-award-delivery-request" || term.length !== 2) throw new TypeError("foreign settled-award delivery operation");
  const result = await deliverSettledResearchAward(term[1], options);
  return agentRmnMessage(semanticBytes(["settled-research-award-delivery-result", result]), "settled-research-award-delivery-result.rmn.cbor");
}

async function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(`${JSON.stringify(await executeAwardDeliveryMessage(JSON.parse(input), { dataRoot: process.env.CURIOSITY_RESEARCH_MARKET_DATA_ROOT }))}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
