import "server-only";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";

export interface StorageDriver {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Short-lived signed URL, or null when the driver streams through the app instead. */
  signedUrl(key: string, opts: { fileName: string; contentType: string; disposition: "inline" | "attachment"; ttlSeconds?: number }): Promise<string | null>;
  exists(key: string): Promise<boolean>;
}

/** Private local-disk storage for development. Files are never served statically. */
class LocalDriver implements StorageDriver {
  private root = path.resolve(env().LOCAL_STORAGE_DIR);
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, body: Uint8Array) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body, { flag: "wx" }); // never overwrite: versions are immutable
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.resolve(key)));
  }
  async signedUrl() {
    return null;
  }
  async exists(key: string) {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

/** S3-compatible private bucket (AWS S3, Cloudflare R2, MinIO…). */
class S3Driver implements StorageDriver {
  private clientPromise = (async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const e = env();
    return new S3Client({
      region: e.S3_REGION ?? "us-east-1",
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: e.S3_FORCE_PATH_STYLE === "true",
      credentials: e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } : undefined,
    });
  })();
  private bucket = env().S3_BUCKET!;

  async put(key: string, body: Uint8Array, contentType: string) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientPromise).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: "AES256" }));
  }
  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await this.clientPromise).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return new Uint8Array(await res.Body!.transformToByteArray());
  }
  async signedUrl(key: string, opts: { fileName: string; contentType: string; disposition: "inline" | "attachment"; ttlSeconds?: number }) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: `${opts.disposition}; filename="${opts.fileName.replace(/["\\\r\n]/g, "_")}"`,
    });
    return getSignedUrl(await this.clientPromise, cmd, { expiresIn: opts.ttlSeconds ?? 60 });
  }
  async exists(key: string) {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      await (await this.clientPromise).send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (driver) return driver;
  if (env().STORAGE_DRIVER === "s3") {
    if (!env().S3_BUCKET) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
    driver = new S3Driver();
  } else {
    if (env().NODE_ENV === "production" && env().ALLOW_LOCAL_STORAGE !== "true") {
      // Local disk is not durable on serverless platforms; refuse to silently lose documents.
      throw new Error("STORAGE_DRIVER=local is not allowed in production. Configure S3-compatible storage (or set ALLOW_LOCAL_STORAGE=true on a single server with a persistent disk).");
    }
    driver = new LocalDriver();
  }
  return driver;
}
