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

describe("RequestPlugin timeout classification (requestTimeout, milliseconds)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters Status-0 timeouts on whitelisted URLs under the default threshold (elapsed 60055ms)", () => {
    const { plugin, reportData, breadcrumb } = makePlugin({
      ignoreErrors: { timeoutUrls: ["api.example.com/report"] },
    });

    plugin.handleData(
      {
        url: "https://api.example.com/report/poll",
        Status: 0,
        time: Date.now(),
        elapsedTime: 60055,
      },
      EVENT_TYPE.XHR
    );

    expect(reportData.send).not.toHaveBeenCalled();
    expect(breadcrumb.push).not.toHaveBeenCalled();
  });

  it("still reports fast Status-0 failures on whitelisted URLs (elapsed 3000ms is no timeout)", () => {
    const { plugin, reportData } = makePlugin({
      ignoreErrors: { timeoutUrls: ["api.example.com/report"] },
    });

    plugin.handleData(
      {
        url: "https://api.example.com/report/fast",
        Status: 0,
        time: Date.now(),
        elapsedTime: 3000,
      },
      EVENT_TYPE.XHR
    );

    expect(reportData.send).toHaveBeenCalledTimes(1);
    expect(reportData.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "httpError",
        status: STATUS_CODE.ERROR,
        data: expect.objectContaining({
          message: expect.stringContaining("请求失败，Status值为:0"),
        }),
      })
    );
  });

  it("honours a custom requestTimeout in ms: 9600/10000 hits the whitelist, 500 does not", () => {
    const { plugin, reportData } = makePlugin({
      requestTimeout: 10000,
      ignoreErrors: { timeoutUrls: ["api.example.com/slow"] },
    });

    // 9600ms ≥ 10000*0.95 → 超时，命中白名单 → 过滤
    plugin.handleData(
      {
        url: "https://api.example.com/slow/a",
        Status: 0,
        time: Date.now(),
        elapsedTime: 9600,
      },
      EVENT_TYPE.XHR
    );
    expect(reportData.send).not.toHaveBeenCalled();

    // 500ms 不构成超时 → 白名单不适用，照常上报
    plugin.handleData(
      {
        url: "https://api.example.com/slow/b",
        Status: 0,
        time: Date.now(),
        elapsedTime: 500,
      },
      EVENT_TYPE.XHR
    );
    expect(reportData.send).toHaveBeenCalledTimes(1);
  });

  it("labels Status-0 as 接口超时 from exactly 95% of requestTimeout, Status值为:0 below", () => {
    const { plugin, reportData } = makePlugin({ requestTimeout: 10000 });

    plugin.handleData(
      {
        url: "https://api.example.com/t/at-boundary",
        Status: 0,
        time: Date.now(),
        elapsedTime: 9500, // 10000 * 0.95，恰好达到
      },
      EVENT_TYPE.XHR
    );
    plugin.handleData(
      {
        url: "https://api.example.com/t/below-boundary",
        Status: 0,
        time: Date.now(),
        elapsedTime: 9499,
      },
      EVENT_TYPE.XHR
    );

    expect(reportData.send).toHaveBeenCalledTimes(2);
    expect(reportData.send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.stringContaining("请求失败，接口超时"),
        }),
      })
    );
    expect(reportData.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.stringContaining("请求失败，Status值为:0"),
        }),
      })
    );
  });

  it("ignores overTime (route threshold) for HTTP timeout classification", () => {
    // 回归防守：旧实现读 overTime 并按秒 *1000，毫秒接入方的超时白名单/文案全部失效
    const { plugin, reportData } = makePlugin({
      overTime: 5000,
      ignoreErrors: { timeoutUrls: ["api.example.com/legacy"] },
    });

    // 6000ms 超过 overTime，但远低于默认 60s 请求超时阈值 → 不是超时，白名单不生效，照常上报
    plugin.handleData(
      {
        url: "https://api.example.com/legacy/poll",
        Status: 0,
        time: Date.now(),
        elapsedTime: 6000,
      },
      EVENT_TYPE.XHR
    );

    expect(reportData.send).toHaveBeenCalledTimes(1);
    expect(reportData.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.stringContaining("请求失败，Status值为:0"),
        }),
      })
    );
  });
});

// 防线级回归：历史事故为 SDK 包装 fetch 后覆盖了 AWS S3 已签名请求头，
// 宿主应用全部上传失败。以下不变量保证「监控代码绝不改变业务请求的行为」。
describe("wrapper safety (never break host requests)", () => {
  type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  const fetchGlobal = globalThis as { fetch: FetchLike };
  const realFetch = fetchGlobal.fetch;
  const realXhrOpen = XMLHttpRequest.prototype.open;
  const realXhrSend = XMLHttpRequest.prototype.send;
  const livePlugins: Array<RequestPlugin> = [];

  type CapturedCall = { self: unknown; args: Array<unknown> };

  // 在插件构造之前替换 XHR 原型方法，使插件把这些桩当作「原始方法」包装，
  // 从而可以精确断言透传的 this/args，且不发真实请求
  function stubXhrPrototype() {
    const openCalls: Array<CapturedCall> = [];
    const sendCalls: Array<CapturedCall> = [];
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      ...args: Array<unknown>
    ): void {
      openCalls.push({ self: this, args });
    };
    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest,
      ...args: Array<unknown>
    ): void {
      sendCalls.push({ self: this, args });
    };
    return { openCalls, sendCalls };
  }

  function makeSafePlugin(options?: Partial<IOptionsParams>) {
    const made = makePlugin(options);
    livePlugins.push(made.plugin);
    return made;
  }

  function stubGlobalFetch(impl: FetchLike) {
    const stub = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      impl(input, init)
    );
    fetchGlobal.fetch = stub;
    return stub;
  }

  afterEach(() => {
    for (const plugin of livePlugins.splice(0)) {
      plugin.destroy();
    }
    fetchGlobal.fetch = realFetch;
    XMLHttpRequest.prototype.open = realXhrOpen;
    XMLHttpRequest.prototype.send = realXhrSend;
    vi.restoreAllMocks();
  });

  it("A: XHR send without a monitoring record passes through untouched (same this/args, no listener, no report)", () => {
    const { sendCalls } = stubXhrPrototype();
    const { plugin } = makeSafePlugin();
    const handleDataSpy = vi.spyOn(plugin, "handleData");

    // 模拟 open 发生在 SDK 包装之前：实例上没有 record_xhr
    const xhr = new XMLHttpRequest();
    const body = new Blob(["chunk-1"]);
    expect(() => xhr.send(body)).not.toThrow();

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].self).toBe(xhr);
    expect(sendCalls[0].args).toHaveLength(1);
    expect(sendCalls[0].args[0]).toBe(body);

    // 缺 record 时不得注册 loadend 监听，也不得上报
    xhr.dispatchEvent(new Event("loadend"));
    expect(handleDataSpy).not.toHaveBeenCalled();
  });

  it("B: fetch(Request) with beforeAppAjaxSend passes the exact Request instance and injects nothing (S3/SigV4)", async () => {
    const res = new Response("ok", { status: 200 });
    const originalFetch = stubGlobalFetch(() => Promise.resolve(res));
    const beforeAppAjaxSend = vi.fn(
      (_req: { method: string; url: string }, headers: Headers) => {
        headers.set("X-Monitor-Trace", "trace-1");
      }
    );
    makeSafePlugin({ beforeAppAjaxSend });
    const wrappedFetch = fetchGlobal.fetch;

    const signed = new Request("https://s3.example.com/bucket/part-1", {
      method: "PUT",
      headers: { Authorization: "AWS4-HMAC-SHA256 signature" },
    });
    await wrappedFetch(signed);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    const [firstArg, init] = originalFetch.mock.calls[0];
    // 同一个 Request 实例原样透传
    expect(firstArg).toBe(signed);
    // init 不得携带注入头（init.headers 会整体覆盖 Request 上已签好名的请求头）
    expect(init?.headers).toBeUndefined();
    // monitoring 头直接丢弃：Request 形态下不调用注入回调
    expect(beforeAppAjaxSend).not.toHaveBeenCalled();
    // 签名保留
    expect(signed.headers.get("Authorization")).toBe("AWS4-HMAC-SHA256 signature");
  });

  it("B: fetch(url, init) with beforeAppAjaxSend injects headers into a copy, never mutating the caller's config", async () => {
    const originalFetch = stubGlobalFetch(() =>
      Promise.resolve(new Response("ok", { status: 200 }))
    );
    makeSafePlugin({
      beforeAppAjaxSend: (
        _req: { method: string; url: string },
        headers: Headers
      ) => {
        headers.set("X-Monitor-Trace", "trace-1");
      },
    });
    const wrappedFetch = fetchGlobal.fetch;

    const callerHeaders = { "Content-Type": "application/json" };
    const callerConfig: RequestInit = {
      method: "POST",
      headers: callerHeaders,
      body: '{"a":1}',
    };
    await wrappedFetch("https://api.example.com/data", callerConfig);

    const [, init] = originalFetch.mock.calls[0];
    const sentHeaders = init?.headers;
    expect(sentHeaders).toBeInstanceOf(Headers);
    if (!(sentHeaders instanceof Headers)) {
      throw new Error("headers must be a Headers instance");
    }
    // 注入生效，且原有头保留
    expect(sentHeaders.get("X-Monitor-Trace")).toBe("trace-1");
    expect(sentHeaders.get("Content-Type")).toBe("application/json");
    // 调用方的 config 对象不被原地污染
    expect(init).not.toBe(callerConfig);
    expect(callerConfig.headers).toBe(callerHeaders);
    expect(callerHeaders).toEqual({ "Content-Type": "application/json" });
  });

  it("C: resolves the exact same Response object, never clones/consumes the body without handleHttpStatus, but still reports", async () => {
    const res = new Response("file-bytes", { status: 200 });
    const cloneSpy = vi.spyOn(res, "clone");
    stubGlobalFetch(() => Promise.resolve(res));
    const { plugin } = makeSafePlugin();
    const handleDataSpy = vi.spyOn(plugin, "handleData");
    const wrappedFetch = fetchGlobal.fetch;

    const out = await wrappedFetch("https://api.example.com/download");
    await flush();

    expect(out).toBe(res);
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(res.bodyUsed).toBe(false);
    expect(handleDataSpy).toHaveBeenCalledTimes(1);
    expect(handleDataSpy.mock.calls[0][0].url).toBe(
      "https://api.example.com/download"
    );
    expect(handleDataSpy.mock.calls[0][0].Status).toBe(200);
  });

  it("D: rejects with the exact same error the original fetch rejected with", async () => {
    const err = new Error("ECONNRESET");
    stubGlobalFetch(() => Promise.reject(err));
    const { plugin } = makeSafePlugin();
    const handleDataSpy = vi.spyOn(plugin, "handleData");
    const wrappedFetch = fetchGlobal.fetch;

    await expect(wrappedFetch("https://api.example.com/fail")).rejects.toBe(err);
    expect(handleDataSpy).toHaveBeenCalledTimes(1);
    expect(handleDataSpy.mock.calls[0][0].Status).toBe(0);
  });

  it("D: still rejects with the same error when the filter predicate itself throws (skipReport fallback)", async () => {
    const err = new Error("network down");
    stubGlobalFetch(() => Promise.reject(err));
    const { plugin, reportData } = makeSafePlugin();
    reportData.isFilterHttpUrl.mockImplementation(() => {
      throw new Error("filter exploded");
    });
    const handleDataSpy = vi.spyOn(plugin, "handleData");
    const wrappedFetch = fetchGlobal.fetch;

    await expect(wrappedFetch("https://api.example.com/fail")).rejects.toBe(err);
    expect(handleDataSpy).not.toHaveBeenCalled();
  });

  it("D: still rejects with the same error when reporting itself throws on the error path", async () => {
    const err = new Error("aborted");
    stubGlobalFetch(() => Promise.reject(err));
    const { plugin } = makeSafePlugin();
    vi.spyOn(plugin, "handleData").mockImplementation(() => {
      throw new Error("report exploded");
    });
    const wrappedFetch = fetchGlobal.fetch;

    await expect(wrappedFetch("https://api.example.com/fail")).rejects.toBe(err);
  });

  it("E: filter predicate throwing on a successful request still resolves the original Response (skipReport fallback)", async () => {
    const res = new Response("ok", { status: 200 });
    stubGlobalFetch(() => Promise.resolve(res));
    const { plugin, reportData } = makeSafePlugin();
    reportData.isFilterHttpUrl.mockImplementation(() => {
      throw new Error("filter exploded");
    });
    const handleDataSpy = vi.spyOn(plugin, "handleData");
    const wrappedFetch = fetchGlobal.fetch;

    await expect(wrappedFetch("https://api.example.com/upload")).resolves.toBe(
      res
    );
    expect(handleDataSpy).not.toHaveBeenCalled();
  });

  it("E: handleData throwing on a successful request still resolves the original Response (success-handler try/catch)", async () => {
    const res = new Response("ok", { status: 200 });
    stubGlobalFetch(() => Promise.resolve(res));
    const { plugin } = makeSafePlugin();
    const handleDataSpy = vi
      .spyOn(plugin, "handleData")
      .mockImplementation(() => {
        throw new Error("report exploded");
      });
    const wrappedFetch = fetchGlobal.fetch;

    const out = await wrappedFetch("https://api.example.com/upload");
    expect(out).toBe(res);
    expect(handleDataSpy).toHaveBeenCalledTimes(1);
  });

  it("F: XHR loadend with non-JSON text response never throws out of the listener and still reports the raw text", () => {
    stubXhrPrototype();
    const { reportData } = makeSafePlugin({ handleHttpStatus: () => true });

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/legacy-xml");
    xhr.send();
    // responseType 保持 ''，response 是非 JSON 文本：JSON.parse 必然失败
    Object.defineProperty(xhr, "status", { value: 500, configurable: true });
    Object.defineProperty(xhr, "response", {
      value: "<xml>not json</xml>",
      configurable: true,
    });

    expect(() => xhr.dispatchEvent(new Event("loadend"))).not.toThrow();

    expect(reportData.send).toHaveBeenCalledTimes(1);
    const sent = reportData.send.mock.calls[0][0];
    // 解析失败必须保留原文本，而不是丢弃或抛出
    expect(sent.data.response.data).toBe("<xml>not json</xml>");
  });

  it("G: a reused XHR instance reports exactly once per request, each with its own url", () => {
    stubXhrPrototype();
    const { plugin } = makeSafePlugin();
    const handleDataSpy = vi
      .spyOn(plugin, "handleData")
      .mockImplementation(() => undefined);

    const xhr = new XMLHttpRequest();
    Object.defineProperty(xhr, "status", { value: 200, configurable: true });
    Object.defineProperty(xhr, "response", { value: "", configurable: true });

    xhr.open("GET", "https://api.example.com/first");
    xhr.send();
    xhr.dispatchEvent(new Event("loadend"));
    expect(handleDataSpy).toHaveBeenCalledTimes(1);
    expect(handleDataSpy.mock.calls[0][0].url).toBe(
      "https://api.example.com/first"
    );

    xhr.open("GET", "https://api.example.com/second");
    xhr.send();
    xhr.dispatchEvent(new Event("loadend"));
    // 旧监听器不得堆叠重复触发；第二次上报必须归属第二个 url
    expect(handleDataSpy).toHaveBeenCalledTimes(2);
    expect(handleDataSpy.mock.calls[1][0].url).toBe(
      "https://api.example.com/second"
    );
  });

  it("H: oversized string bodies are truncated with a [truncated] marker in the report", async () => {
    stubGlobalFetch(() => Promise.resolve(new Response("ok", { status: 200 })));
    const { breadcrumb } = makeSafePlugin();
    const wrappedFetch = fetchGlobal.fetch;

    const body = "a".repeat(9000);
    await wrappedFetch("https://api.example.com/big", { method: "POST", body });

    expect(breadcrumb.push).toHaveBeenCalledTimes(1);
    const summary = breadcrumb.push.mock.calls[0][0].data.requestData.data;
    expect(typeof summary).toBe("string");
    expect(summary.startsWith("a".repeat(8192))).toBe(true);
    expect(summary).toContain("[truncated");
    expect(summary).toContain("9000");
    // 摘要必须显著短于原文（8192 + 标记），否则上报体积失控
    expect(summary.length).toBeLessThan(8300);
  });

  it("H: Blob bodies are reported as a descriptive string, not an object reference", async () => {
    stubGlobalFetch(() => Promise.resolve(new Response("ok", { status: 200 })));
    const { breadcrumb } = makeSafePlugin();
    const wrappedFetch = fetchGlobal.fetch;

    const body = new Blob(["hello world"], { type: "text/plain" });
    await wrappedFetch("https://api.example.com/blob", { method: "POST", body });

    const summary = breadcrumb.push.mock.calls[0][0].data.requestData.data;
    expect(summary).toBe("[Blob 11B text/plain]");
  });

  it("H: short string bodies are kept verbatim", async () => {
    stubGlobalFetch(() => Promise.resolve(new Response("ok", { status: 200 })));
    const { breadcrumb } = makeSafePlugin();
    const wrappedFetch = fetchGlobal.fetch;

    await wrappedFetch("https://api.example.com/small", {
      method: "POST",
      body: "user=42",
    });

    const summary = breadcrumb.push.mock.calls[0][0].data.requestData.data;
    expect(summary).toBe("user=42");
  });
});
