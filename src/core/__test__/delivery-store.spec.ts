import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { DeliveryStore, StoredEvent } from "../delivery-store";

function record(id: string, createdAt = Date.now(), bytes = 10): StoredEvent {
  return { id, scope: "project", payload: JSON.stringify({ eventId: id }), bytes, createdAt, kind: "event" };
}

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("bounded atomic delivery storage", () => {
  it("evicts oldest records by count, including snapshots", async () => {
    const store = new DeliveryStore("project", { maxEvents: 2 });
    const now = Date.now();
    await store.put(record("oldest", now - 3));
    await store.put({ ...record("snapshot", now - 2), kind: "snapshot", ownerId: "old-page", tabId: "tab" });
    await store.put(record("newest", now - 1));
    expect((await store.recover("tab", "new-page")).map((row) => row.id)).toEqual(["snapshot", "newest"]);
  });

  it("evicts oldest records by UTF-8 payload bytes without exceeding the bound", async () => {
    const store = new DeliveryStore("project", { maxBytes: 20 });
    const now = Date.now();
    await store.put(record("oldest", now - 3, 11));
    await store.put(record("middle", now - 2, 10));
    await store.put(record("newest", now - 1, 10));
    expect((await store.recover()).map((row) => row.id)).toEqual(["middle", "newest"]);
    expect(await store.put(record("oversize", now, 21))).toBe(false);
    expect((await store.recover()).map((row) => row.id)).toEqual(["middle", "newest"]);
  });

  it("expires records before recovery and honors zero retention", async () => {
    const store = new DeliveryStore("project", { maxAgeMs: 1000 });
    await store.put(record("expired", Date.now() - 1001));
    await store.put(record("fresh"));
    expect((await store.recover()).map((row) => row.id)).toEqual(["fresh"]);
    const disabledRetention = new DeliveryStore("project", { maxEvents: 0 });
    expect(await disabledRetention.put(record("discarded"))).toBe(false);
    expect(await disabledRetention.recover()).toEqual([]);
  });

  it("does not let concurrent promotion or a new page overwrite an older snapshot", async () => {
    const store = new DeliveryStore("project");
    await store.put({ ...record("old-snapshot"), kind: "snapshot", ownerId: "old-page", tabId: "tab" });
    const [, recovered] = await Promise.all([
      store.put({ ...record("current-snapshot"), kind: "snapshot", ownerId: "current-page", tabId: "tab" }),
      store.recover("tab", "current-page"),
    ]);
    expect(recovered.map((row) => row.id)).toEqual(["old-snapshot"]);
    await store.remove("old-snapshot");
    expect((await store.recover("tab", "next-page")).map((row) => row.id)).toEqual(["current-snapshot"]);
  });

  it("keeps promoted diagnostics gated by tab and current monitoring opt-in", async () => {
    const store = new DeliveryStore("project");
    await store.put({ ...record("snapshot"), kind: "snapshot", ownerId: "old-page", tabId: "tab" });
    await store.recover("tab", "new-page");
    expect(await store.recover()).toEqual([]);
    expect(await store.recover("other-tab", "other-page")).toEqual([]);
    expect((await store.recover("tab", "next-page"))[0].id).toBe("snapshot");
  });

  it("reports clean snapshot ids deleted by recovery and by retention pruning", async () => {
    const store = new DeliveryStore("project", { maxAgeMs: 1000 });
    const now = Date.now();
    await store.put({
      ...record("clean", now),
      kind: "snapshot",
      ownerId: "old-page",
      tabId: "tab",
    });
    await store.put({
      ...record("kept", now),
      kind: "snapshot",
      ownerId: "old-page",
      tabId: "other-tab",
    });
    // put() 自己会淘汰已过期行，这里直接写入一条已过期快照，确认 recover 的 prune 也会回报它。
    const inserted = Promise.withResolvers<void>();
    const request = indexedDB.open("tc-tracker-delivery", 1);
    request.onerror = () => inserted.reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("events", "readwrite");
      tx.objectStore("events").put({
        ...record("expired-clean", now - 1001),
        kind: "snapshot",
        ownerId: "old-page",
        tabId: "tab",
      });
      tx.oncomplete = () => { db.close(); inserted.resolve(); };
      tx.onabort = () => { db.close(); inserted.reject(tx.error); };
    };
    await inserted.promise;
    const dropped: string[] = [];
    const recovered = await store.recover(
      "tab",
      "new-page",
      undefined,
      new Set(["clean", "expired-clean", "kept", "missing"]),
      dropped
    );
    expect(recovered.map((row) => row.id)).toEqual([]);
    expect(dropped.sort()).toEqual(["clean", "expired-clean"]);
    expect((await store.recover("other-tab", "new-page")).map((row) => row.id)).toEqual(["kept"]);
  });

  it("rejects an aborted transaction rather than claiming a successful write", async () => {
    const store = new DeliveryStore("project");
    const invalid = record("invalid");
    Object.defineProperty(invalid, "payload", { get() { throw new Error("cannot clone"); }, enumerable: true });
    await expect(store.put(invalid)).rejects.toThrow();
    expect(await store.recover()).toEqual([]);
  });

  it("limits blocked database opens and closes late successful opens", async () => {
    vi.useFakeTimers();
    const request = {} as IDBOpenDBRequest;
    vi.spyOn(indexedDB, "open").mockReturnValue(request);
    const work = new DeliveryStore("project").put(record("pending"));
    const assertion = expect(work).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    const close = vi.fn();
    Object.defineProperty(request, "result", { value: { close } });
    request.onsuccess?.call(request, new Event("success"));
    expect(close).toHaveBeenCalledOnce();
  });
});

it("checks snapshot generation inside the write/delete transaction, not when queued", async () => {
  const store = new DeliveryStore("project");
  await store.put(record("snapshot"));
  let generation = 1;
  const stalePut = store.put({ ...record("snapshot"), payload: "stale" }, () => generation === 1);
  generation = 2;
  expect(await stalePut).toBe(false);
  expect((await store.recover())[0].payload).not.toBe("stale");
  const staleDelete = store.remove("snapshot", () => generation === 2);
  generation = 3;
  await staleDelete;
  expect(await store.recover()).toHaveLength(1);
});
