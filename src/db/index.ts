import { MongoClient, type Collection, type Db } from "mongodb";
import type { LogRow, RunRow, SentRow } from "@/lib/types";

/* ------------------------------ documents -------------------------------- */

export interface RunDoc {
  _id: string; // uuid
  role: string;
  query: string;
  maxEmails: number;
  customizeResume: boolean;
  status: string; // queued | running | completed | stopped | failed
  sentCount: number;
  skippedCount: number;
  postsScanned: number;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface SentDoc {
  _id: string; // uuid
  runId: string | null;
  email: string;
  postLink: string;
  postAuthor: string;
  role: string;
  subject: string;
  matchedSkills: string;
  customized: boolean;
  status: string; // SENT | FAILED
  error: string | null;
  sentAt: Date;
}

export interface LogDoc {
  runId: string;
  seq: number;
  level: string; // info | ok | warn | err | mail | sys
  message: string;
  createdAt: Date;
}

/* ---------------------------- connection --------------------------------- */

interface Cached {
  client: MongoClient;
  db: Db;
  embedded: boolean;
}

const g = globalThis as typeof globalThis & {
  __reachMongo?: Cached;
  __reachMongoPromise?: Promise<Cached>;
};

function mongoUri(): string {
  return (process.env.MONGODB_URI || "mongodb://127.0.0.1:27017").trim();
}

function mongoDbName(): string {
  return (process.env.MONGODB_DB || "reachpilot").trim() || "reachpilot";
}

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection("runs").createIndex({ createdAt: -1 }),
    db.collection("sent_emails").createIndex({ email: 1, postLink: 1 }, { unique: true }),
    db.collection("sent_emails").createIndex({ runId: 1 }),
    db.collection("sent_emails").createIndex({ sentAt: -1 }),
    db.collection("sent_emails").createIndex({ email: 1 }),
    db.collection("run_logs").createIndex({ runId: 1, seq: 1 }),
    db.collection("run_logs").createIndex({ seq: 1 }),
  ]);
}

async function connect(): Promise<Cached> {
  const dbName = mongoDbName();
  const uri = mongoUri();

  // 1) Try the configured MongoDB first (fast timeout → quick fallback).
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2500 });
    await client.connect();
    const db = client.db(dbName);
    await ensureIndexes(db);
    return { client, db, embedded: false };
  } catch (err) {
    if (process.env.MONGODB_DISABLE_EMBEDDED === "1") throw err;
    // 2) Embedded MongoDB (downloads a mongod binary once, then cached).
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const mem = await MongoMemoryServer.create({ instance: { dbName } });
    const client = new MongoClient(mem.getUri());
    await client.connect();
    const db = client.db(dbName);
    await ensureIndexes(db);
    console.warn(
      `[reachpilot] MONGODB_URI (${uri}) unreachable — using embedded in-memory MongoDB. ` +
        `Data resets on restart until a real MongoDB is available.`
    );
    return { client, db, embedded: true };
  }
}

export async function getDb(): Promise<Db> {
  if (g.__reachMongo) return g.__reachMongo.db;
  if (!g.__reachMongoPromise) {
    g.__reachMongoPromise = connect().then((c) => {
      g.__reachMongo = c;
      return c;
    });
  }
  return (await g.__reachMongoPromise).db;
}

export async function mongoStatus(): Promise<{ ok: boolean; embedded: boolean }> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return { ok: true, embedded: Boolean(g.__reachMongo?.embedded) };
  } catch {
    return { ok: false, embedded: Boolean(g.__reachMongo?.embedded) };
  }
}

/* ---------------------------- collections -------------------------------- */

export async function runsCol(): Promise<Collection<RunDoc>> {
  return (await getDb()).collection<RunDoc>("runs");
}

export async function sentCol(): Promise<Collection<SentDoc>> {
  return (await getDb()).collection<SentDoc>("sent_emails");
}

export async function logsCol(): Promise<Collection<LogDoc>> {
  return (await getDb()).collection<LogDoc>("run_logs");
}

/** Monotonic sequence for log cursors (atomic counter doc). */
export async function nextLogSeq(): Promise<number> {
  const db = await getDb();
  const res = (await db
    .collection<{ _id: string; value: number }>("counters")
    .findOneAndUpdate(
      { _id: "log_seq" },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: "after" }
    )) as unknown;
  // Driver >= 6 returns the doc itself ({ _id, value });
  // older drivers wrapped it as { value: doc }. Unwrap only the wrapper shape.
  let doc: unknown = res;
  if (
    doc &&
    typeof doc === "object" &&
    "value" in (doc as Record<string, unknown>) &&
    !("_id" in (doc as Record<string, unknown>))
  ) {
    doc = (doc as { value: unknown }).value;
  }
  if (
    doc &&
    typeof doc === "object" &&
    typeof (doc as { value?: unknown }).value === "number"
  ) {
    return (doc as { value: number }).value;
  }
  return 1;
}

export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

/* ------------------------------- DTOs ------------------------------------ */

export function toRunRow(d: RunDoc): RunRow {
  return {
    id: d._id,
    role: d.role,
    query: d.query,
    maxEmails: d.maxEmails,
    customizeResume: d.customizeResume,
    status: d.status,
    sentCount: d.sentCount,
    skippedCount: d.skippedCount,
    postsScanned: d.postsScanned,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
    finishedAt: d.finishedAt ? d.finishedAt.toISOString() : null,
  };
}

export function toSentRow(d: SentDoc): SentRow {
  return {
    id: d._id,
    runId: d.runId,
    email: d.email,
    postLink: d.postLink,
    postAuthor: d.postAuthor,
    role: d.role,
    subject: d.subject,
    matchedSkills: d.matchedSkills,
    customized: d.customized,
    status: d.status,
    error: d.error,
    sentAt: d.sentAt.toISOString(),
  };
}

export function toLogRow(d: LogDoc): LogRow {
  return {
    id: d.seq,
    runId: d.runId,
    level: d.level,
    message: d.message,
    createdAt: d.createdAt.toISOString(),
  };
}
