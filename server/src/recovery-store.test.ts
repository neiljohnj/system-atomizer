import { afterEach, expect, test, vi } from "vitest";
import type { ActivityInput } from "../../src/types";
import { clearRecovery, readRecovery, rememberRecovery, writeRecovery } from "../../src/features/authoring/recoveryStore";

afterEach(() => vi.unstubAllGlobals());
const draft = (key: string, title: string) => ({ key, input: { title } as ActivityInput, serverRevision: 1, savedAt: "2026-09-10" });

test("unavailable device storage preserves the newest account-scoped draft across editor lifetimes", async () => {
  vi.stubGlobal("indexedDB", { open() { throw new Error("Storage unavailable"); } });
  await expect(writeRecovery(draft("faculty-a:activity-1", "First"))).rejects.toThrow();
  rememberRecovery(draft("faculty-a:activity-1", "Latest before unmount"));
  expect(await readRecovery("faculty-a:activity-1")).toMatchObject({ persisted: false, input: { title: "Latest before unmount" } });
  await expect(readRecovery("faculty-b:activity-1")).rejects.toThrow();
  await expect(clearRecovery("faculty-a:activity-1")).rejects.toThrow();
  expect(await readRecovery("faculty-a:activity-1")).toBeNull();
});

test("writes and clears serialize; an earlier commit cannot claim a newer draft is durable", async () => {
  const pending: Array<{ oncomplete?: () => void; onabort?: () => void; error: Error | null }> = [];
  const close = vi.fn();
  vi.stubGlobal("indexedDB", { open() {
    const request: { onsuccess?: () => void; result: unknown } = { result: { close, transaction() {
      const transaction = { error: null, objectStore: () => ({ put: () => ({}), delete: () => ({}) }) };
      pending.push(transaction); return transaction;
    } } };
    queueMicrotask(() => request.onsuccess?.()); return request;
  } });
  const key = "serialized:activity-2";
  const first = writeRecovery(draft(key, "First"));
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  const second = writeRecovery(draft(key, "Second"));
  pending[0].oncomplete?.(); await first;
  expect(await readRecovery(key)).toMatchObject({ persisted: false, input: { title: "Second" } });
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1].onabort?.(); await expect(second).rejects.toThrow("aborted");
  expect((await readRecovery(key))?.persisted).toBe(false);
  const clear = clearRecovery(key);
  await vi.waitFor(() => expect(pending).toHaveLength(3));
  pending[2].oncomplete?.(); await clear;
  expect(await readRecovery(key)).toBeNull();
  expect(close).toHaveBeenCalledTimes(3);
});
