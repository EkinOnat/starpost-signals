import { EVIDENCE_API_URL } from "../config";
import { metadataHash, sha256Hex, type EvidenceStage } from "../domain/impact";

export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
export const EVIDENCE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/json",
]);

export type EvidenceProgress = {
  stage: EvidenceStage;
  contentHash?: string;
  metadataHash?: string;
  uploadedBytes?: number;
  totalBytes?: number;
};

export type EvidenceReceipt = {
  contentHash: string;
  metadataHash: string;
  objectUrl: string;
};

function requireEvidenceService() {
  if (!EVIDENCE_API_URL) throw new Error("EVIDENCE_UPLOAD_FAILED");
}

async function apiFetch(path: string, init?: RequestInit) {
  requireEvidenceService();
  const response = await fetch(`${EVIDENCE_API_URL}${path}`, init);
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(result?.error === "hash_mismatch" ? "EVIDENCE_HASH_MISMATCH" : "EVIDENCE_UPLOAD_FAILED");
  }
  return response;
}

export async function storeContentAddressedJson(value: unknown): Promise<string> {
  const hash = await metadataHash(value);
  await apiFetch(`/api/v1/metadata/${hash}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  return hash;
}

export async function readContentAddressedJson<T>(hash: string): Promise<T | null> {
  if (!EVIDENCE_API_URL || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  const response = await fetch(`${EVIDENCE_API_URL}/api/v1/metadata/${hash}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("EVIDENCE_UPLOAD_FAILED");
  return response.json() as Promise<T>;
}

export function validateEvidenceFile(file: File): string[] {
  const errors: string[] = [];
  if (!file.size) errors.push("Choose a non-empty evidence file.");
  if (file.size > MAX_EVIDENCE_BYTES) errors.push("Evidence files may be at most 20 MB.");
  if (!EVIDENCE_TYPES.has(file.type)) errors.push("Use PDF, JPEG, PNG, WebP, text, CSV, or JSON evidence.");
  return errors;
}

export async function uploadEvidence(
  file: File,
  metadata: Record<string, unknown>,
  onProgress: (progress: EvidenceProgress) => void,
): Promise<EvidenceReceipt> {
  onProgress({ stage: "validating" });
  if (validateEvidenceFile(file).length) throw new Error("INVALID_EVIDENCE_FILE");
  requireEvidenceService();

  onProgress({ stage: "hashing", totalBytes: file.size });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentHash = await sha256Hex(bytes);
  const evidenceMetadata = {
    schema: "starpost.evidence/1",
    ...metadata,
    filename: file.name,
    mediaType: file.type,
    size: file.size,
    contentHash,
  };
  const metadataHashHex = await metadataHash(evidenceMetadata);

  onProgress({ stage: "uploading", contentHash, metadataHash: metadataHashHex, totalBytes: file.size });
  const reservation = await apiFetch("/api/v1/evidence/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentHash,
      metadataHash: metadataHashHex,
      mediaType: file.type,
      size: file.size,
    }),
  }).then((response) => response.json()) as { uploadId: string; uploadUrl: string };

  await apiFetch(reservation.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      "X-Content-SHA256": contentHash,
    },
    body: bytes,
  });
  await storeContentAddressedJson(evidenceMetadata);
  onProgress({
    stage: "stored",
    contentHash,
    metadataHash: metadataHashHex,
    uploadedBytes: file.size,
    totalBytes: file.size,
  });
  return {
    contentHash,
    metadataHash: metadataHashHex,
    objectUrl: `${EVIDENCE_API_URL}/api/v1/evidence/${contentHash}`,
  };
}
