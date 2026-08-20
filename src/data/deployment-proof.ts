import {
  IMPACT_ESCROW_CONTRACT_ID,
  IMPACT_REGISTRY_CONTRACT_ID,
} from "../config";

// Mirrors docs/level4/evidence/contract-deployment.json. These are immutable
// public Testnet proofs, not sample projects or inferred financial state.
export const IMPACT_DEPLOYMENT_PROOF = {
  network: "Stellar Testnet",
  deployedAt: "2026-08-14T23:32:00Z",
  contracts: [
    {
      name: "Impact Registry V1",
      role: "Policy and verification",
      contractId: IMPACT_REGISTRY_CONTRACT_ID,
      wasmSha256: "0dc2a777489b37ed20051fd4cac107711387e0c3d90098766a4471f5777ce2e7",
    },
    {
      name: "Impact Escrow V1",
      role: "Asset custody and payout",
      contractId: IMPACT_ESCROW_CONTRACT_ID,
      wasmSha256: "6a6f5e77ecb6e80f67943e348112084249adf8f17a9803ba4f16f35fecbb627f",
    },
  ],
  transactions: [
    { label: "Registry WASM", txHash: "2b745d023545f2b003126523017c637ff63f1699caa313f5c3ddaca4d0dcb90a" },
    { label: "Registry deploy", txHash: "adcbedd29f3f6cd92220d49b3b76de18d793dfd606aa6dbda9343220fa9b2db8" },
    { label: "Escrow WASM", txHash: "02fe500768b67b92d3afd328bb31f2ca9beb744f3b0b03e1992739f7488517ca" },
    { label: "Escrow deploy", txHash: "a86984d770bb98227420ce0315576d2e1002f098fe00e9fafa33d2099ac867de" },
    { label: "Escrow initialize", txHash: "8248cbfd1a146036dce84b0a40aad5d05e2cb405899d0e915b6dcab97373f2c4" },
    { label: "Registry initialize", txHash: "e079fdd361034c66cf09661473a3c5c5be363b3642780773fb7ba66af939f1a2" },
  ],
} as const;
