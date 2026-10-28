import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { ReportDataController } from "../report";
import { Breadcrumb } from "../breadcrumb";
import { EVENT_TYPE, STATUS_CODE } from "../constant";
import { IOptionsParams } from "../../typings/options";
import { ISendData } from "../typing";
import { StoredEvent } from "../delivery-store";

const context = vi.hoisted(() => ({ pageUrl: "https://app.test/original", session: "original-session", sequence: 0 }));
vi.mock("../../utils", () => ({
  generateUUID: () => `event-${++context.sequence}`,
  getLocationHref: () => context.pageUrl,
  isEmpty: (value: unknown) => !value,
}));
vi.mock("../global", () => ({ Global: { deviceInfo: { browser: "Chrome" } } }));
vi.mock("../session-manager", () => ({ SessionManager: { getSessionId: () => context.session } }));

const pageKey = Symbol.for("tc-tracker.delivery-page");
const controllers: ReportDataController[] = [];
function nextDocument() {
  Reflect.deleteProperty(document, pageKey);
}
function create(options: Partial<IOptionsParams> = {}, stack: unknown[] = []) {
  const controller = new ReportDataController({
    options: { dsn: "https://collector.test/report", apikey: "project-a", ...options },
    breadcrumb: { getStack: () => stack } as unknown as Breadcrumb,
  });
  controllers.push(controller);
  return controller;
}
function event(name = "error"): ISendData {
  return { type: EVENT_TYPE.ERROR, status: STATUS_CODE.ERROR, name, time: 1234, data: { message: name } };
}
function rows(): Promise<StoredEvent[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("tc-tracker-delivery", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("events", "readonly");
      const read = tx.objectStore("events").getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

beforeEach(() => {
  vi.spyOn(window, "addEventListener");
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn((_name: string, _options: unknown, callback: (lock: object) => Promise<void> | void) =>
        Promise.resolve(callback({}))),
    },
  });
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
  sessionStorage.clear();
  nextDocument();
  context.pageUrl = "https://app.test/original";
  context.session = "original-session";
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.destroy());
  vi.mocked(window.addEventListener).mock.calls.forEach(([type, listener, options]) => {
    window.removeEventListener(type, listener, typeof options === "boolean" ? options : options?.capture);
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("acknowledged durable reports", () => {
  it("retains HTTP failures and replays the frozen original context/id without the new hook", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const stack = [{ name: "original breadcrumb" }];
    const first = create({ getUserId: () => "original-user", beforeDataReport: (value) => ({ ...value, filtered: true }) }, stack);
    expect(await first.send(event())).toBe(false);
    const [stored] = await rows();
    const original = JSON.parse(stored.payload);
    stack[0].name = "changed";
    context.pageUrl = "https://app.test/new";
    context.session = "new-session";
    first.destroy();
    nextDocument();
    const hook = vi.fn(() => false);
    create({ getUserId: () => "new-user", beforeDataReport: hook }).startRecovery();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch).mock.calls[1][1]?.body).toBe(stored.payload);
    expect(original).toMatchObject({ time: 1234, pageUrl: "https://app.test/original", sessionID: "original-session", userInfo: { userId: "original-user" }, breadcrumb: [{ name: "original breadcrumb" }], filtered: true });
    expect(original.eventId).toBeTruthy();
    expect(hook).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await rows()).toEqual([]));
  });

  it("commits before fetch and deletes only after HTTP 2xx", async () => {
    let acknowledge!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
    const pending = create().send(event());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(await rows()).toHaveLength(1);
    acknowledge({ ok: true, status: 204 } as Response);
    expect(await pending).toBe(true);
    expect(await rows()).toEqual([]);
  });

  it("persists later events and snapshots while the first fetch is hung; destroy preserves them", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const first = create({ memoryMonitor: { enabled: true } });
    const pending = first.send(event("first"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const second = first.send(event("second"));
    await first.saveDiagnosticSnapshot(event("snapshot"));
    expect(await rows()).toHaveLength(3);
    expect(fetch).toHaveBeenCalledOnce();
    first.destroy();
    expect(await pending).toBe(false);
    expect(await second).toBe(false);
    nextDocument();
    create({ memoryMonitor: { enabled: true } }).startRecovery(true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    await vi.waitFor(async () => expect(await rows()).toEqual([]));
  });

  it("does not duplicate new events when startup recovery races their commit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    const old = create();
    await old.send(event("old"));
    old.destroy();
    const current = create();
    const sent = current.send(event("new"));
    current.startRecovery();
    current.startRecovery();
    expect(await sent).toBe(true);
    await vi.waitFor(async () => expect(await rows()).toEqual([]));
    const names = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).name);
    expect(names.filter((name) => name === "new")).toHaveLength(1);
    expect(names.filter((name) => name === "old")).toHaveLength(2);
  });

  it("retains network failures and assigns independent IDs even for the same input object", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const controller = create();
    const input = event();
    expect(await controller.send(input)).toBe(false);
    expect(await controller.send(input)).toBe(false);
    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(stored[0].id).not.toBe(stored[1].id);
    expect(input.eventId).toBeUndefined();
  });

  it("never accesses recovery storage when disabled, but still confirms direct delivery", async () => {
    const open = vi.spyOn(indexedDB, "open");
    const controller = create({ recovery: { enabled: false } });
    controller.startRecovery(true);
    await controller.saveDiagnosticSnapshot(event());
    await controller.clearDiagnosticSnapshot();
    expect(await controller.send(event())).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "throws"])("fails open when IndexedDB %s", async (failure) => {
    if (failure === "unavailable") vi.stubGlobal("indexedDB", undefined);
    else vi.spyOn(indexedDB, "open").mockImplementation(() => { throw new Error("blocked"); });
    const controller = create();
    controller.startRecovery();
    expect(await controller.send(event())).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("filters rejected/thrown hooks without sending or rejecting application calls", async () => {
    const hook = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("private"));
    const controller = create({ beforeDataReport: hook });
    expect(await controller.send(event())).toBe(false);
    expect(await controller.send(event())).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("times out a hanging fetch and releases subsequent delivery without an automatic retry", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const controller = create({ recovery: { enabled: false } });
    const first = controller.send(event("first"));
    const second = controller.send(event("second"));
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("isolates both destination and project key", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await create().send(event("a"));
    await create({ apikey: "project-b" }).send(event("b"));
    await create({ dsn: "https://other.test/report" }).send(event("other"));
    vi.mocked(fetch).mockClear().mockResolvedValue({ ok: true } as Response);
    create().startRecovery();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).name).toBe("a");
    await vi.waitFor(async () => expect(await rows()).toHaveLength(2));
  });
});

describe("diagnostic snapshot recovery", () => {
  it("replaces only this document's snapshot with a stable ID and never sends immediately", async () => {
    const controller = create();
    await controller.saveDiagnosticSnapshot(event("first"));
    const [original] = await rows();
    await controller.saveDiagnosticSnapshot(event("latest"));
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(original.id);
    expect(JSON.parse(stored[0].payload).name).toBe("latest");
    expect(fetch).not.toHaveBeenCalled();
    await controller.clearDiagnosticSnapshot();
    expect(await rows()).toEqual([]);
  });

  it("does not recover itself across multiple TrackInit calls in the same document", async () => {
    await create().saveDiagnosticSnapshot(event());
    create({ memoryMonitor: { enabled: true } }).startRecovery(true);
    // A later snapshot operation provides a barrier after recovery on this controller.
    const same = create({ memoryMonitor: { enabled: true } });
    same.startRecovery(true);
    await same.saveDiagnosticSnapshot(event("newest"));
    expect(fetch).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(1);
  });

  it("preserves old snapshots when a new page writes and clears its own; failed promotion stays replayable", async () => {
    await create().saveDiagnosticSnapshot(event("old snapshot"));
    const [original] = await rows();
    nextDocument();
    const current = create({ memoryMonitor: { enabled: true } });
    await current.saveDiagnosticSnapshot(event("new snapshot"));
    await current.clearDiagnosticSnapshot();
    expect(await rows()).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    current.startRecovery(true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [promoted] = await rows();
    expect(promoted.kind).toBe("event");
    expect(promoted.payload).toBe(original.payload);
    current.destroy();
    nextDocument();
    create({ memoryMonitor: { enabled: true } }).startRecovery(true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch).mock.calls[1][1]?.body).toBe(original.payload);
    await vi.waitFor(async () => expect(await rows()).toEqual([]));
  });

  it.each(["plugin disabled", "monitor disabled", "other tab", "locks unavailable"])("does not recover a snapshot when %s", async (reason) => {
    await create().saveDiagnosticSnapshot(event("snapshot"));
    nextDocument();
    if (reason === "other tab") sessionStorage.setItem("tc-tracker.delivery-tab", "another-tab");
    if (reason === "locks unavailable") vi.stubGlobal("navigator", {});
    const current = create({ memoryMonitor: { enabled: reason !== "monitor disabled" } });
    current.startRecovery(reason !== "plugin disabled");
    await current.send(event("barrier"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(await rows()).toHaveLength(1);
  });

  it.each(["filtered", "throws", "oversize"])("clears this page's old sensitive snapshot when replacement is %s", async (reason) => {
    const hook = vi.fn((value) => value);
    const current = create({ beforeDataReport: hook });
    await current.saveDiagnosticSnapshot(event("sensitive"));
    if (reason === "filtered") hook.mockImplementation(() => false);
    if (reason === "throws") hook.mockImplementation(() => { throw new Error("private"); });
    await current.saveDiagnosticSnapshot(event(reason === "oversize" ? "x".repeat(64 * 1024) : "replacement"));
    expect(await rows()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("snapshot page identity", () => {
  it("keeps ordinary outbox recovery available when sessionStorage is denied", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await create().send(event("ordinary"));
    nextDocument();
    vi.spyOn(sessionStorage, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const current = create({ memoryMonitor: { enabled: true } });
    current.startRecovery(true);
    await current.saveDiagnosticSnapshot(event("cannot persist snapshot"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await rows()).toEqual([]));
  });

  it("gives a copied tab a fresh identity when the original document holds its Web Lock", async () => {
    const held = new Set<string>();
    const locks = {
      request: vi.fn((name: string, _options: unknown, callback: (lock: object | null) => Promise<void> | void) => {
        const available = !held.has(name);
        if (available) held.add(name);
        return Promise.resolve(callback(available ? { name } : null));
      }),
    };
    vi.stubGlobal("navigator", { locks });
    const original = create();
    await original.saveDiagnosticSnapshot(event("original tab snapshot"));
    const originalTab = sessionStorage.getItem("tc-tracker.delivery-tab");
    nextDocument(); // A duplicated tab inherits the sessionStorage tab id, not the document.
    const duplicate = create({ memoryMonitor: { enabled: true } });
    duplicate.startRecovery(true);
    await duplicate.saveDiagnosticSnapshot(event("duplicate tab snapshot"));
    expect(sessionStorage.getItem("tc-tracker.delivery-tab")).not.toBe(originalTab);
    expect(fetch).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(2);
    window.dispatchEvent(new Event("pagehide"));
  });
});

it("rotates snapshot identity on BFCache resume without overwriting the prior evidence", async () => {
  const controller = create();
  await controller.saveDiagnosticSnapshot(event("before cache"));
  const [previous] = await rows();
  // Happy DOM 17 aliases PageTransitionEvent to Event, dropping `persisted`.
  // Supply the browser's event property explicitly rather than changing the contract.
  for (const type of ["pagehide", "pageshow"]) {
    const transition = new Event(type);
    Object.defineProperty(transition, "persisted", { value: true });
    window.dispatchEvent(transition);
  }
  await controller.saveDiagnosticSnapshot(event("after cache"));
  const stored = await rows();
  expect(stored).toHaveLength(2);
  expect(stored.find((row) => row.id === previous.id)?.payload).toBe(previous.payload);
  expect(stored.find((row) => row.id !== previous.id)?.payload).toContain("after cache");
});

it("does not rotate the snapshot for an ordinary initial pageshow", async () => {
  const controller = create();
  await controller.saveDiagnosticSnapshot(event("initial"));
  const [previous] = await rows();
  const transition = new Event("pageshow");
  Object.defineProperty(transition, "persisted", { value: false });
  window.dispatchEvent(transition);
  await controller.saveDiagnosticSnapshot(event("latest"));
  const stored = await rows();
  expect(stored).toHaveLength(1);
  expect(stored[0].id).toBe(previous.id);
  expect(stored[0].payload).toContain("latest");
});

describe("independent asynchronous preparation", () => {
  it("lets later events and snapshots commit while an earlier hook never settles", async () => {
    const hook = vi.fn((value) => value.name === "blocked" ? new Promise(() => {}) : value);
    const controller = create({ beforeDataReport: hook });
    const pending = controller.send(event("blocked"));
    expect(await controller.send(event("ready"))).toBe(true);
    await controller.saveDiagnosticSnapshot(event("ready snapshot"));
    expect(await rows()).toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
    controller.destroy();
    expect(await pending).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["old data", "filtered"])("does not let a slow cross-controller snapshot hook returning %s replace newer evidence", async (outcome) => {
    let release!: (value: unknown) => void;
    const old = create({ beforeDataReport: () => new Promise((resolve) => { release = resolve; }) });
    const pending = old.saveDiagnosticSnapshot(event("old"));
    const current = create();
    await current.saveDiagnosticSnapshot(event("new"));
    const [newest] = await rows();
    release(outcome === "filtered" ? false : event("old"));
    await pending;
    expect(await rows()).toEqual([newest]);
  });

  it("keeps snapshot ordering independent across destination/project scopes", async () => {
    let release!: (value: unknown) => void;
    const first = create({ beforeDataReport: () => new Promise((resolve) => { release = resolve; }) });
    const pending = first.saveDiagnosticSnapshot(event("project a"));
    await create({ apikey: "project-b" }).saveDiagnosticSnapshot(event("project b"));
    release(event("project a"));
    await pending;
    expect(await rows()).toHaveLength(2);
  });

  it("settles an unresolved snapshot hook on destroy without deleting previous evidence", async () => {
    const current = create();
    await current.saveDiagnosticSnapshot(event("previous"));
    const [previous] = await rows();
    current.beforeDataReport = () => new Promise(() => {});
    const pending = current.saveDiagnosticSnapshot(event("blocked"));
    current.destroy();
    await pending;
    expect(await rows()).toEqual([previous]);
  });

  it("lets hooks sanitize cycles and BigInt and preserves Date types until filtering finishes", async () => {
    const date = new Date("2025-01-01T00:00:00.000Z");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const hook = vi.fn((value) => {
      expect(value.data.date).toBe(date);
      expect(value.data.date).toBeInstanceOf(Date);
      return { ...value, data: { sanitized: true } };
    });
    const controller = create({ beforeDataReport: hook });
    const input = event();
    input.data = { date, cycle, number: BigInt(1) };
    expect(await controller.send(input)).toBe(true);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).data).toEqual({ sanitized: true });
  });
});

describe("recovered acknowledgement observers", () => {
  it("notifies only confirmed replays with their original context and isolates observers", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await create().send(event("original"));
    const [original] = await rows();
    const failed = create();
    const failedListener = vi.fn();
    failed.onRecoveredReport(failedListener);
    failed.startRecovery();
    await failed.saveDiagnosticSnapshot(event("barrier"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(failedListener).not.toHaveBeenCalled();
    failed.destroy();
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    context.pageUrl = "https://app.test/new";
    context.session = "new-session";
    const current = create();
    const listener = vi.fn();
    const removed = vi.fn();
    current.onRecoveredReport(() => { throw new Error("observer failure"); });
    current.onRecoveredReport(listener);
    current.onRecoveredReport(removed)();
    current.startRecovery();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(listener).toHaveBeenCalledWith(JSON.parse(original.payload));
    expect(removed).not.toHaveBeenCalled();
  });

  it("does not notify after destroy or for normal send acknowledgements", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await create().send(event("old"));
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const current = create();
    const listener = vi.fn();
    current.onRecoveredReport(listener);
    current.startRecovery();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    current.destroy();
    const normal = create();
    normal.onRecoveredReport(listener);
    expect(await normal.send(event("normal"))).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });
});

it("disables diagnostic persistence without Web Locks but still delivers ordinary events", async () => {
  vi.stubGlobal("navigator", {});
  sessionStorage.setItem("tc-tracker.delivery-tab", "inherited-tab");
  const current = create({ memoryMonitor: { enabled: true } });
  current.startRecovery(true);
  await current.saveDiagnosticSnapshot(event("snapshot"));
  expect(await current.send(event("ordinary"))).toBe(true);
  expect(await rows()).toEqual([]);
  expect(sessionStorage.getItem("tc-tracker.delivery-tab")).toBe("inherited-tab");
});

it("does not let an iframe replace its top-level page's tab identity", async () => {
  sessionStorage.setItem("tc-tracker.delivery-tab", "top-tab");
  vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
  const frame = create({ memoryMonitor: { enabled: true } });
  frame.startRecovery(true);
  await frame.saveDiagnosticSnapshot(event("frame snapshot"));
  expect(await frame.send(event("frame ordinary"))).toBe(true);
  expect(sessionStorage.getItem("tc-tracker.delivery-tab")).toBe("top-tab");
  expect(navigator.locks.request).not.toHaveBeenCalled();
  expect(await rows()).toEqual([]);
});

it("recovers same-tab diagnostics after ordinary navigation when Web Locks are available", async () => {
  await create().saveDiagnosticSnapshot(event("previous document"));
  nextDocument();
  vi.mocked(performance.getEntriesByType).mockReturnValue([]);
  create({ memoryMonitor: { enabled: true } }).startRecovery(true);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await vi.waitFor(async () => expect(await rows()).toEqual([]));
});

it("retains a replay if destroy wins the continuation after HTTP confirmation, allowing reinit to observe it", async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
  await create().send(event("original"));
  const [original] = await rows();
  const current = create();
  const interrupted = vi.fn();
  current.onRecoveredReport(interrupted);
  vi.mocked(fetch).mockResolvedValueOnce({
    get ok() {
      queueMicrotask(() => current.destroy());
      return true;
    },
  } as Response);
  current.startRecovery();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(interrupted).not.toHaveBeenCalled();
  expect(await rows()).toEqual([original]);
  const next = create();
  const confirmed = vi.fn();
  next.onRecoveredReport(confirmed);
  next.startRecovery();
  await vi.waitFor(() => expect(confirmed).toHaveBeenCalledWith(JSON.parse(original.payload)));
  await vi.waitFor(async () => expect(await rows()).toEqual([]));
});

it("freezes synchronous hook output before send returns control to the caller", async () => {
  const stack = [{ name: "before" }];
  const current = create({ beforeDataReport: (value) => value }, stack);
  const pending = current.send(event("original"));
  stack[0].name = "after";
  expect(await pending).toBe(true);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).breadcrumb).toEqual([{ name: "before" }]);
});
