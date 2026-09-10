import type { ActivityInput } from "../../types";

export interface RecoveryDraft {
  key: string;
  input: ActivityInput;
  serverRevision: number;
  savedAt: string;
}

const DATABASE_NAME = "atom-authoring-recovery";
const STORE_NAME = "drafts";
const tabDrafts = new Map<string, RecoveryDraft & { persisted: boolean }>();
const clearedKeys = new Set<string>();

// Survives route and session changes in this tab, with the account in every key.
// This is deliberately not described as a device save.
export function rememberRecovery(draft: RecoveryDraft): void {
  clearedKeys.delete(draft.key);
  tabDrafts.set(draft.key, { ...draft, persisted: false });
}

if (typeof window !== "undefined") window.addEventListener("beforeunload", event => {
  if ([...tabDrafts.values()].some(draft => !draft.persisted)) event.preventDefault();
});

export async function readRecovery(key: string): Promise<(RecoveryDraft & { persisted: boolean }) | null> {
  if (tabDrafts.has(key)) return tabDrafts.get(key)!;
  if (clearedKeys.has(key)) return null;
  const database = await openRecoveryDatabase();
  try { const stored = await new Promise<RecoveryDraft | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    transaction.oncomplete = () => resolve((request.result as RecoveryDraft | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Device storage read aborted"));
  });
    return tabDrafts.get(key) ?? (clearedKeys.has(key) ? null : stored ? { ...stored, persisted: true } : null);
  } finally { database.close(); }
}

const operations = new Map<string, Promise<void>>();
function serialize(key: string, work: () => Promise<void>): Promise<void> {
  const next = (operations.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  operations.set(key, next);
  void next.finally(() => { if (operations.get(key) === next) operations.delete(key); }).catch(() => {});
  return next;
}

export async function writeRecovery(draft: RecoveryDraft): Promise<void> {
  rememberRecovery(draft);
  const remembered = tabDrafts.get(draft.key)!;
  return serialize(draft.key, async () => {
    const database = await openRecoveryDatabase();
    try {
      await transactionPromise(database, "readwrite", (store) => store.put(draft));
      if (tabDrafts.get(draft.key) === remembered) remembered.persisted = true;
    }
    finally { database.close(); }
  });
}

export async function clearRecovery(key: string): Promise<void> {
  tabDrafts.delete(key);
  clearedKeys.add(key);
  return serialize(key, async () => {
    const database = await openRecoveryDatabase();
    try { await transactionPromise(database, "readwrite", (store) => store.delete(key)); }
    finally { database.close(); }
  });
}

function openRecoveryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Device storage is blocked by another tab")); };
  });
}

function transactionPromise(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    work(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Device storage transaction aborted"));
  });
}
