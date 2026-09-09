import type { ActivityInput } from "../../types";

export interface RecoveryDraft {
  key: string;
  input: ActivityInput;
  serverRevision: number;
  savedAt: string;
}

const DATABASE_NAME = "atom-authoring-recovery";
const STORE_NAME = "drafts";

export async function readRecovery(key: string): Promise<RecoveryDraft | null> {
  const database = await openRecoveryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as RecoveryDraft | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function writeRecovery(draft: RecoveryDraft): Promise<void> {
  const database = await openRecoveryDatabase();
  await transactionPromise(database, "readwrite", (store) => store.put(draft));
}

export async function clearRecovery(key: string): Promise<void> {
  const database = await openRecoveryDatabase();
  await transactionPromise(database, "readwrite", (store) => store.delete(key));
}

function openRecoveryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
  });
}
