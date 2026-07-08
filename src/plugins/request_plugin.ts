import { Breadcrumb } from "../core/breadcrumb";
import {
  EMethods,
  EVENT_TYPE,
  HTTP_CODE,
  PLUGIN_TYPE,
  STATUS_CODE,
} from "../core/constant";
import { _global } from "../core/global";
import { ReportDataController } from "../core/report";
import { HttpData, voidFun } from "../core/typing";
import { IOptionsParams } from "../typings/options";
import {
  addEventListenerTo,
  fromHttpStatus,
  getTimestamp,
  isString,
  replaceAop,
} from "../utils";
import { HTTP_TYPE, IPluginParams } from "./common";

// 错误去重时间窗口（同一 url+status 在窗口内只上报一次）
const DEDUPE_WINDOW = 60 * 1000;
// 去重缓存最大容量，超出后惰性清理，避免无限增长
const MAX_DEDUPE_CACHE = 100;
// 页面跳转导致的请求中断判定阈值（Status=0 且耗时极短）
const PAGE_NAVIGATION_ELAPSED = 200;
// HTTP 超时判定默认阈值（毫秒）。注意与 overTime（路由慢检测阈值）无关：
// 此前这里复用 overTime 并按「秒」乘 1000，接入方若按毫秒传（如 5000）阈值会被放大成 5000 秒，
// 导致超时文案与 ignoreErrors.timeoutUrls 永远不生效
const DEFAULT_REQUEST_TIMEOUT = 60 * 1000;
// 请求体在上报里只保留可读摘要：
// - 大字符串截断（sendBeacon 的排队配额在 64KB 量级，超大 payload 会让上报静默失败）
// - File/Blob 等二进制概括为描述字符串，避免上传文件被面包屑长期引用造成内存驻留
const MAX_BODY_SNIPPET = 8 * 1024;
function summarizeRequestBody(body: unknown): string {
  if (body == null || body === "") {
    return "";
  }
  if (isString(body)) {
    return body.length > MAX_BODY_SNIPPET
      ? `${body.slice(0, MAX_BODY_SNIPPET)}...[truncated, total ${body.length} chars]`
      : body;
  }
  if (typeof File !== "undefined" && body instanceof File) {
    return `[File ${body.name} ${body.size}B ${body.type}]`;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return `[Blob ${body.size}B ${body.type}]`;
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return "[FormData]";
  }
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return `[ArrayBuffer ${body.byteLength}B]`;
  }
  if (ArrayBuffer.isView(body)) {
    return `[BinaryView ${body.byteLength}B]`;
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return summarizeRequestBody(body.toString());
  }
  if (typeof body === "object") {
    try {
      return summarizeRequestBody(JSON.stringify(body));
    } catch {
      return Object.prototype.toString.call(body);
    }
  }
  return String(body);
}

// XHR 实例上挂的监控记录
type XhrRecord = {
  method: string;
  url: string;
  sTime: number;
  type: HTTP_TYPE;
  requestData?: Document | XMLHttpRequestBodyInit | null;
  time?: number;
  Status?: number;
  response?: unknown;
  elapsedTime?: number;
};
type MonitoredXhr = XMLHttpRequest & { record_xhr?: XhrRecord };

// fetch 包装器内部的上报草稿
type FetchRecord = {
  type: HTTP_TYPE;
  method: string;
  requestData: BodyInit | null | undefined;
  url: string;
  response: string;
  time: number;
  elapsedTime?: number;
  Status?: number;
};

export class RequestPlugin {
  name = PLUGIN_TYPE.REQUEST_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;

  // 错误去重缓存：key = url + status
  private errorCache = new Map<string, number>();
  // 保存被改写前的原始方法，便于 destroy 时还原，避免重复挂载/内存泄漏
  private originalXhrOpen: voidFun | null = null;
  private originalXhrSend: voidFun | null = null;
  private originalFetch: voidFun | null = null;
  // 保存改写后的引用，destroy 时仅在全局仍是我们的包装时才还原，避免覆盖他人包装
  private wrappedFetch: voidFun | null = null;
  private wrappedXhrOpen: voidFun | null = null;
  private wrappedXhrSend: voidFun | null = null;
  private isSetup = false;

  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }
  setup() {
    if (this.isSetup) return;
    this.isSetup = true;
    this.xhrReplace();
    this.fetchReplace();
  }
  xhrReplace(): void {
    const _this = this;
    if (!("XMLHttpRequest" in _global)) {
      return;
    }
    const originalXhrProto = XMLHttpRequest.prototype;
    this.originalXhrOpen = originalXhrProto.open;
    this.originalXhrSend = originalXhrProto.send;
    replaceAop(originalXhrProto, "open", (originalOpen: voidFun) => {
      return function (
        this: MonitoredXhr,
        ...args: Parameters<XMLHttpRequest["open"]>
      ): void {
        this.record_xhr = {
          method: isString(args[0]) ? args[0].toUpperCase() : String(args[0]),
          // open(method, url) 的 url 允许是 URL 对象，统一成字符串，监控/过滤才有效
          url: isString(args[1]) ? args[1] : String(args[1]),
          sTime: getTimestamp(),
          type: HTTP_TYPE.XHR,
        };
        originalOpen.apply(this, args);
      };
    });
    replaceAop(originalXhrProto, "send", (originalSend: voidFun) => {
      return function (
        this: MonitoredXhr,
        ...args: Parameters<XMLHttpRequest["send"]>
      ): void {
        const record = this.record_xhr;
        // open 未经过本插件包装（如 SDK 懒加载完成前创建的 xhr）时没有 record。
        // 监控缺数据绝不能阻断业务请求：原样透传
        if (!record) {
          originalSend.apply(this, args);
          return;
        }
        const { method, url } = record;
        // once：XHR 实例被复用（再次 open+send）时旧监听器不会堆叠导致重复上报；
        // 闭包持有本次 send 对应的 record，复用后也不会把旧请求记到新地址上
        addEventListenerTo(
          this,
          "loadend",
          function (this: MonitoredXhr) {
            // 监控自身异常必须静默：这里抛出去会变成业务页面的未捕获错误
            try {
              if (
                (method === EMethods.Post &&
                  _this.reportData?.isSdkTransportUrl?.(url)) ||
                _this.reportData?.isFilterHttpUrl?.(url)
              )
                return;
              const { responseType, response, status } = this;
              record.requestData = args[0];
              const eTime = getTimestamp();
              // 设置该接口的time，用户行为按时间排序
              record.time = record.sTime;
              record.Status = status;
              if (["", "json", "text"].indexOf(responseType) !== -1) {
                // 用户设置handleHttpStatus函数来判断接口是否正确，只有接口报错时才保留response
                if (_this.options?.handleHttpStatus?.call(_this, record)) {
                  try {
                    // responseType 为 "json" 时 response 已是对象、也可能是非 JSON 文本，
                    // 解析失败一律保留原值，绝不抛出
                    record.response = isString(response)
                      ? JSON.parse(response)
                      : response;
                  } catch {
                    record.response = response;
                  }
                }
              }
              // 接口的执行时长
              record.elapsedTime = eTime - record.sTime;
              _this.handleData(record, EVENT_TYPE.XHR);
            } catch {
              // 上报链路异常不影响业务
            }
          },
          { once: true }
        );
        originalSend.apply(this, args);
      };
    });
    this.wrappedXhrOpen = originalXhrProto.open;
    this.wrappedXhrSend = originalXhrProto.send;
  }

  fetchReplace() {
    const _this = this;
    if (!("fetch" in _global)) {
      return;
    }
    this.originalFetch = _global.fetch as voidFun;
    replaceAop(_global, EVENT_TYPE.FETCH, (originalFetch: typeof fetch) => {
      return function (
        url: RequestInfo | URL,
        config: RequestInit = {}
      ): Promise<Response> {
        const sTime = getTimestamp();
        // fetch(Request) / fetch(URL) 形态下只读取元数据用于上报，绝不改动请求本身
        const requestArg = url instanceof Request ? url : null;
        const urlStr = isString(url)
          ? url
          : requestArg
            ? requestArg.url
            : String(url);
        const method = String(
          (config && config.method) || (requestArg && requestArg.method) || "GET"
        ).toUpperCase();
        const fetchData: FetchRecord = {
          type: HTTP_TYPE.FETCH,
          method,
          requestData: config && config.body,
          url: urlStr,
          response: "",
          time: sTime,
        };
        // 仅在配置了 beforeAppAjaxSend 且是 (url, init) 调用形态时才介入请求头。
        // 事故防线（AWS S3 上传曾因此挂掉）：fetch(Request) 形态下注入 init.headers
        // 会整体覆盖 Request 上已签好名的请求头（SigV4 等），这种形态必须原样透传
        if (_this.options?.beforeAppAjaxSend && !requestArg) {
          try {
            const headers = new Headers(config.headers || {});
            const compatHeaders = headers as Headers & {
              setRequestHeader?: Headers["set"];
            };
            compatHeaders.setRequestHeader = headers.set.bind(headers);
            _this.options.beforeAppAjaxSend({ method, url: urlStr }, compatHeaders);
            config = Object.assign({}, config, { headers });
          } catch {
            // 注入失败保持原请求不动：宁可丢监控头，不能碰坏业务请求
          }
        }
        // 过滤判定提前完成，判定本身抛错也不能影响请求
        let skipReport = false;
        try {
          skipReport = Boolean(
            (method === EMethods.Post &&
              _this.reportData?.isSdkTransportUrl?.(urlStr)) ||
              _this.reportData?.isFilterHttpUrl?.(urlStr)
          );
        } catch {
          skipReport = true;
        }
        return originalFetch.apply(_global, [url, config]).then(
          (res: Response) => {
            // 监控逻辑整体兜底：任何异常都不允许改变业务拿到的响应
            try {
              if (!skipReport) {
                fetchData.elapsedTime = getTimestamp() - sTime;
                fetchData.Status = res.status;
                if (_this.options?.handleHttpStatus) {
                  // 只有配置了 handleHttpStatus（需要读响应体判断业务错误码）才 clone + 读取。
                  // clone 会 tee 响应流：SDK 这一支会把整份响应缓冲在内存里，
                  // 大文件下载/流式响应场景开销巨大，未配置时完全不碰响应体
                  const tempRes = res.clone();
                  tempRes
                    .text()
                    .then((data: string) => {
                      // 用户设置handleHttpStatus函数来判断接口是否正确，只有接口报错时才保留response
                      if (_this.options?.handleHttpStatus?.(fetchData)) {
                        fetchData.response = data;
                      }
                      _this.handleData(fetchData, EVENT_TYPE.FETCH);
                    })
                    .catch(() => {
                      // 读取响应体失败也要上报元数据（url/Status 已具备）
                      _this.handleData(fetchData, EVENT_TYPE.FETCH);
                    });
                } else {
                  _this.handleData(fetchData, EVENT_TYPE.FETCH);
                }
              }
            } catch {
              // 上报链路异常静默
            }
            return res;
          },
          (err: unknown) => {
            // 接口报错（网络错误 / 中断）：先上报，再把原始错误原样抛给业务
            try {
              if (!skipReport) {
                fetchData.elapsedTime = getTimestamp() - sTime;
                // 大写 Status 与 handleData 的解构一致，否则网络错误永远识别不出来
                fetchData.Status = 0;
                _this.handleData(fetchData, EVENT_TYPE.FETCH);
              }
            } catch {
              // 上报链路异常静默
            }
            throw err;
          }
        );
      };
    });
    this.wrappedFetch = _global.fetch as voidFun;
  }

  /**
   * 判断 Status=0 的失败是否为超时类错误（耗时达到超时阈值的 95%，容忍客户端中断的抖动）
   */
  private isTimeoutError(status: number, elapsedTime: number): boolean {
    const timeout = this.options.requestTimeout || DEFAULT_REQUEST_TIMEOUT;
    return status === 0 && elapsedTime >= timeout * 0.95;
  }

  /**
   * 判断是否应该过滤该请求错误（降噪）
   */
  private shouldFilterError(
    url: string,
    status: number,
    elapsedTime: number
  ): boolean {
    // 1. 页面跳转导致的请求中断（Status=0 且耗时极短）
    if (status === 0 && elapsedTime < PAGE_NAVIGATION_ELAPSED) {
      return true;
    }
    // 2. 用户自定义过滤逻辑（优先级最高）
    if (this.options.ignoreErrors?.customFilter) {
      if (this.options.ignoreErrors.customFilter({ url, status, elapsedTime })) {
        return true;
      }
    }
    // 3. 超时类错误 + 用户配置的白名单 URL
    const isTimeout = this.isTimeoutError(status, elapsedTime);
    if (isTimeout && this.options.ignoreErrors?.timeoutUrls) {
      if (this.options.ignoreErrors.timeoutUrls.some((p) => url.includes(p))) {
        return true;
      }
    }
    return false;
  }

  /**
   * 错误去重检查（DEDUPE_WINDOW 内相同 url+status 只上报一次）。
   * 使用容量上限 + 惰性清理，避免常驻定时器导致的泄漏。
   */
  private isDuplicateError(url: string, status: number): boolean {
    const key = `${url}_${status}`;
    const now = Date.now();
    const last = this.errorCache.get(key);
    if (last !== undefined && now - last < DEDUPE_WINDOW) {
      return true;
    }
    this.errorCache.set(key, now);
    if (this.errorCache.size > MAX_DEDUPE_CACHE) {
      this.evictStaleCache(now);
    }
    return false;
  }

  private evictStaleCache(now: number): void {
    for (const [k, t] of this.errorCache) {
      if (now - t > DEDUPE_WINDOW) {
        this.errorCache.delete(k);
      }
    }
    // 仍超容量则按插入顺序淘汰最旧项
    while (this.errorCache.size > MAX_DEDUPE_CACHE) {
      const oldest = this.errorCache.keys().next().value;
      if (oldest === undefined) break;
      this.errorCache.delete(oldest);
    }
  }

  handleData(xhrData: any, type: EVENT_TYPE) {
    const { url, Status, elapsedTime } = xhrData;
    const isError =
      Status === 0 ||
      Status === HTTP_CODE.BAD_REQUEST ||
      Status > HTTP_CODE.UNAUTHORIZED;
    const result = this.handleTransForm(xhrData);
    if (!url || typeof url !== "string") {
      return;
    }

    // 成功的请求记录到 breadcrumb（不包括 SDK 自身上报接口）
    if (!isError && !url.includes(this.options.dsn)) {
      this.breadcrumb.push({
        type,
        category: this.breadcrumb.getCategory(type),
        data: { ...result },
        time: xhrData.time,
        status: STATUS_CODE.OK,
      });
    }

    if (isError) {
      // 降噪过滤（页面跳转中断 / 用户自定义 / 超时白名单）
      if (this.shouldFilterError(url, Status, elapsedTime)) {
        return;
      }
      // 去重，避免短时间内相同错误重复上报
      if (this.isDuplicateError(url, Status)) {
        return;
      }

      this.breadcrumb.push({
        type,
        category: this.breadcrumb.getCategory(type),
        data: { ...result },
        time: xhrData.time,
        status: STATUS_CODE.ERROR,
      });

      this.reportData.send({
        type,
        category: this.breadcrumb.getCategory(type),
        data: { ...result },
        time: xhrData.time,
        name: "httpError",
        status: STATUS_CODE.ERROR,
      });
    }
  }
  handleTransForm(data: HttpData) {
    let message: any = "";
    const {
      elapsedTime,
      time,
      method = "",
      type,
      Status = 200,
      response,
      requestData,
    } = data;
    let status: STATUS_CODE;
    if (Status === 0) {
      status = STATUS_CODE.ERROR;
      message = this.isTimeoutError(Status, elapsedTime)
        ? "请求失败，接口超时"
        : `请求失败，Status值为:${Status}`;
    } else if ((Status as number) < HTTP_CODE.BAD_REQUEST) {
      status = STATUS_CODE.OK;
      if (
        this.options.handleHttpStatus &&
        typeof this.options.handleHttpStatus == "function"
      ) {
        if (this.options.handleHttpStatus(data)) {
          status = STATUS_CODE.OK;
        } else {
          status = STATUS_CODE.ERROR;
          message = `接口报错，报错信息为：${
            typeof response == "object" ? JSON.stringify(response) : response
          }`;
        }
      }
    } else {
      status = STATUS_CODE.ERROR;
      message = `请求失败，Status值为:${Status}，${fromHttpStatus(
        Status as number
      )}`;
    }
    message = `${data.url}; ${message}`;
    return {
      url: data.url,
      time,
      status,
      elapsedTime,
      message,
      requestData: {
        httpType: type as string,
        method,
        data: summarizeRequestBody(requestData),
      },
      response: {
        Status,
        data: status == STATUS_CODE.ERROR ? response : null,
      },
    };
  }

  // 还原被改写的全局方法并清空缓存；仅当全局仍是我们的包装时才还原，避免覆盖他人包装
  destroy() {
    if (
      this.originalXhrOpen &&
      XMLHttpRequest.prototype.open === this.wrappedXhrOpen
    ) {
      XMLHttpRequest.prototype.open = this.originalXhrOpen as any;
    }
    if (
      this.originalXhrSend &&
      XMLHttpRequest.prototype.send === this.wrappedXhrSend
    ) {
      XMLHttpRequest.prototype.send = this.originalXhrSend as any;
    }
    if (this.originalFetch && (_global as any).fetch === this.wrappedFetch) {
      (_global as any).fetch = this.originalFetch;
    }
    this.originalXhrOpen = null;
    this.originalXhrSend = null;
    this.originalFetch = null;
    this.wrappedXhrOpen = null;
    this.wrappedXhrSend = null;
    this.wrappedFetch = null;
    this.isSetup = false;
    this.errorCache.clear();
  }
}
