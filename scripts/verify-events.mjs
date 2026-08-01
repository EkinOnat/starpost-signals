import { rpc, scValToNative } from "@stellar/stellar-sdk";

const contractId = "CBHWJQ6Q4FAKCTC5IOS5YJDB2AOP5EF4SE6ODOLACCZZ2B3GV34J3YIP";
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const latest = await server.getLatestLedger();
const response = await server.getEvents({
  filters: [{ type: "contract", contractIds: [contractId] }],
  startLedger: Math.max(1, latest.sequence - 2_000),
  limit: 40,
});

console.log(
  JSON.stringify(
    response.events.map((event) => ({
      id: event.id,
      topics: event.topic.map((topic) => scValToNative(topic)),
      value: scValToNative(event.value),
      txHash: event.txHash,
    })),
    null,
    2,
  ),
);
