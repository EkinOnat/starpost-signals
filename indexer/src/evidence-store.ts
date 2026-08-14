import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ALLOWED_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/json",
]);

type UploadReservation = {
  contentHash: string;
  metadataHash: string;
  mediaType: string;
  size: number;
  expiresAt: number;
};

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export class EvidenceStore {
  private readonly uploads = new Map<string, UploadReservation>();
  private readonly evidenceDir: string;
  private readonly metadataDir: string;
  private readonly temporaryDir: string;

  constructor(private readonly root: string, readonly maxBytes: number) {
    this.evidenceDir = join(root, "evidence");
    this.metadataDir = join(root, "metadata");
    this.temporaryDir = join(root, "temporary");
  }

  async initialize() {
    await Promise.all([
      mkdir(this.evidenceDir, { recursive: true }),
      mkdir(this.metadataDir, { recursive: true }),
      mkdir(this.temporaryDir, { recursive: true }),
    ]);
  }

  reserve(input: { contentHash: string; metadataHash: string; mediaType: string; size: number }) {
    if (!HASH_PATTERN.test(input.contentHash) || !HASH_PATTERN.test(input.metadataHash)) {
      throw new Error("invalid_hash");
    }
    if (!ALLOWED_MEDIA_TYPES.has(input.mediaType)) throw new Error("invalid_media_type");
    if (!Number.isInteger(input.size) || input.size <= 0 || input.size > this.maxBytes) {
      throw new Error("invalid_size");
    }
    this.pruneReservations();
    const uploadId = randomUUID();
    this.uploads.set(uploadId, { ...input, expiresAt: Date.now() + 15 * 60_000 });
    return { uploadId, uploadUrl: `/api/v1/evidence/uploads/${uploadId}` };
  }

  async storeUpload(uploadId: string, bytes: Uint8Array, mediaType: string, claimedHash: string) {
    const reservation = this.uploads.get(uploadId);
    if (!reservation || reservation.expiresAt <= Date.now()) throw new Error("upload_expired");
    if (bytes.byteLength !== reservation.size || bytes.byteLength > this.maxBytes) throw new Error("invalid_size");
    if (mediaType !== reservation.mediaType || claimedHash !== reservation.contentHash) throw new Error("upload_mismatch");
    if (sha256(bytes) !== reservation.contentHash) throw new Error("hash_mismatch");

    const path = join(this.evidenceDir, reservation.contentHash);
    const temporaryPath = join(this.temporaryDir, `${uploadId}.tmp`);
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await rm(temporaryPath, { force: true });
      this.uploads.delete(uploadId);
    }
    await writeFile(`${path}.media-type`, reservation.mediaType, { encoding: "utf8", flag: "w" });
    return { contentHash: reservation.contentHash, size: reservation.size };
  }

  async storeMetadata(hash: string, value: unknown) {
    if (!HASH_PATTERN.test(hash)) throw new Error("invalid_hash");
    const canonical = stableJson(value);
    if (Buffer.byteLength(canonical) > 64 * 1024) throw new Error("metadata_too_large");
    if (sha256(canonical) !== hash) throw new Error("hash_mismatch");
    const path = join(this.metadataDir, `${hash}.json`);
    const temporaryPath = join(this.temporaryDir, `${randomUUID()}.json`);
    await writeFile(temporaryPath, canonical, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async readMetadata(hash: string) {
    if (!HASH_PATTERN.test(hash)) return null;
    try {
      return JSON.parse(await readFile(join(this.metadataDir, `${hash}.json`), "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readEvidence(hash: string) {
    if (!HASH_PATTERN.test(hash)) return null;
    try {
      const path = join(this.evidenceDir, hash);
      const [bytes, mediaType, details] = await Promise.all([
        readFile(path),
        readFile(`${path}.media-type`, "utf8"),
        stat(path),
      ]);
      if (details.size > this.maxBytes || sha256(bytes) !== hash) throw new Error("stored_hash_mismatch");
      const storedMediaType = mediaType.trim();
      if (!ALLOWED_MEDIA_TYPES.has(storedMediaType)) throw new Error("stored_media_type_mismatch");
      return { bytes, mediaType: storedMediaType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private pruneReservations() {
    const now = Date.now();
    for (const [id, reservation] of this.uploads) {
      if (reservation.expiresAt <= now) this.uploads.delete(id);
    }
  }
}
