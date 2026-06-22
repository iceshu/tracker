import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RequestPlugin } from "../request_plugin";
import { EVENT_TYPE, STATUS_CODE } from "../../core/constant";
import { IOptionsParams } from "../../typings/options";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeOkResponse(status: number) {
  return {
    status,
    clone: () => ({
      status,
      text: () => Promise.resolve("response-body-string"),
    }),
  };
}

function makePlugin(options?: Partial<IOptionsParams>) {
  const breadcrumb = {
    push: vi.fn(),
    getCategory: vi.fn().mockReturnValue("Http"),
  } as any;
  const reportData = {
    send: vi.fn(),
    isSdkTransportUrl: vi.fn().mockReturnValue(false),
    isFilterHttpUrl: vi.fn().mockReturnValue(false),
  } as any;
  const plugin = new RequestPlugin({
    options: { dsn: "https://dsn.example.com/collect", ...options } as any,
    breadcrumb,
    reportData,
  });
  return { plugin, breadcrumb, reportData };
}

describe("RequestPlugin fetch wiring (regression)", () => {
  const realFetch = (globalThis as any).fetch;

  afterEach(() => {
    (globalThis as any).fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("passes fetchData (with url + numeric Status) to handleData on success, not the response body string", async () => {
    (globalThis as any).fetch = vi.fn(() =>
      Promise.resolve(makeOkResponse(500))
    );
    const { plugin } = makePlugin();
    const handleDataSpy = vi.spyOn(plugin, "handleData");

    await (globalThis as any).fetch("https://api.example.com/users");
    await flush();

    expect(handleDataSpy).toHaveBeenCalledTimes(1);
    const [arg, type] = handleDataSpy.mock.calls[0];
    expect(type).toBe(EVENT_TYPE.FETCH);
    expect(arg.url).toBe("https://api.example.com/users");
    expect(arg.Status).toBe(500);
    expect(typeof arg.Status).toBe("number");
  });

  it("uses capital Status:0 on network failure so the error is detected", async () => {
    (globalThis as any).fetch = vi.fn(() =>
      Promise.reject(new Error("network down"))
    );
    const { plugin } = makePlugin();
    const handleDataSpy = vi.spyOn(plugin, "handleData");

    await (globalThis as any)
      .fetch("https://api.example.com/fail")
      .catch(() => undefined);
    await flush();

    expect(handleDataSpy).toHaveBeenCalledTimes(1);
    const [arg] = handleDataSpy.mock.calls[0];
    expect(arg.Status).toBe(0);
    expect(arg.status).toBeUndefined();
  });

  it("does not double-instrument fetch when setup() is called twice", async () => {
    (globalThis as any).fetch = vi.fn(() =>
      Promise.resolve(makeOkResponse(500))
    );
    const { plugin } = makePlugin();
    const handleDataSpy = vi.spyOn(plugin, "handleData");
    plugin.setup();

    await (globalThis as any).fetch("https://api.example.com/users");
    await flush();

    expect(handleDataSpy).toHaveBeenCalledTimes(1);
  });

  it("restores original fetch on destroy when global is still our wrapper", () => {
    const original = vi.fn(() => Promise.resolve(makeOkResponse(200)));
    (globalThis as any).fetch = original;
    const { plugin } = makePlugin();
    expect((globalThis as any).fetch).not.toBe(original);

    plugin.destroy();
    expect((globalThis as any).fetch).toBe(original);
  });

  it("does NOT inject headers (passthrough) without beforeAppAjaxSend, preserving signed Request headers (S3/SigV4)", async () => {
    const calls: Array<Array<any>> = [];
    (globalThis as any).fetch = vi.fn((...args: Array<any>) => {
      calls.push(args);
      return Promise.resolve(makeOkResponse(200));
    });
    makePlugin(); // no beforeAppAjaxSend configured

    // AWS SDK style: a single pre-signed Request object
    const signedRequest = {
      url: "https://s3.example.com/bucket/part",
      method: "PUT",
      headers: new Headers({ authorization: "AWS4-HMAC-SHA256 ..." }),
    };
    await (globalThis as any).fetch(signedRequest);
    await flush();

    expect(calls).toHaveLength(1);
    // first arg must be the same Request, untouched
    expect(calls[0][0]).toBe(signedRequest);
    // second arg must NOT carry a headers key (would override the Request's signed headers)
    expect(calls[0][1]?.headers).toBeUndefined();
  });

  it("injects headers only when beforeAppAjaxSend is configured", async () => {
    const calls: Array<Array<any>> = [];
    (globalThis as any).fetch = vi.fn((...args: Array<any>) => {
      calls.push(args);
      return Promise.resolve(makeOkResponse(200));
    });
    makePlugin({ beforeAppAjaxSend: () => undefined } as any);

    await (globalThis as any).fetch("https://api.example.com/x", { method: "GET" });
    await flush();

    expect(calls[0][1]?.headers).toBeInstanceOf(Headers);
  });
});

describe("RequestPlugin.handleData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports http errors and dedupes identical url+status within the window", () => {
    const { plugin, reportData } = makePlugin();
    const xhrData = {
      url: "https://api.example.com/list",
      Status: 500,
      time: Date.now(),
      elapsedTime: 300,
    };

    plugin.handleData(xhrData, EVENT_TYPE.XHR);
    plugin.handleData({ ...xhrData }, EVENT_TYPE.XHR);

    expect(reportData.send).toHaveBeenCalledTimes(1);
    expect(reportData.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "httpError", status: STATUS_CODE.ERROR })
    );
  });

  it("does not report successful requests but records them in breadcrumb", () => {
    const { plugin, reportData, breadcrumb } = makePlugin();

    plugin.handleData(
      {
        url: "https://api.example.com/ok",
        Status: 200,
        time: Date.now(),
        elapsedTime: 50,
      },
      EVENT_TYPE.XHR
    );

    expect(reportData.send).not.toHaveBeenCalled();
    expect(breadcrumb.push).toHaveBeenCalledWith(
      expect.objectContaining({ status: STATUS_CODE.OK })
    );
  });

  it("filters page-navigation aborts (Status 0, very short elapsed)", () => {
    const { plugin, reportData } = makePlugin();

    plugin.handleData(
      {
        url: "https://api.example.com/aborted",
        Status: 0,
        time: Date.now(),
        elapsedTime: 50,
      },
      EVENT_TYPE.XHR
    );

    expect(reportData.send).not.toHaveBeenCalled();
  });
});
