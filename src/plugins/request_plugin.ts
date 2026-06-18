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
      return function (this: any, ...args: any[]): void {
        this.record_xhr = {
          method: isString(args[0]) ? args[0].toUpperCase() : args[0],
          url: args[1],
          sTime: getTimestamp(),
          type: HTTP_TYPE.XHR,
        };
        originalOpen.apply(this, args);
      };
    });
    replaceAop(originalXhrProto, "send", (originalSend: voidFun) => {
      return function (this: any, ...args: any): void {
        const { method, url } = this.record_xhr;
        // 监听loadend事件，接口成功或失败都会执行
        addEventListenerTo(this, "loadend", function (this: any) {
          if (
            (method === EMethods.Post &&
              _this.reportData?.isSdkTransportUrl?.(url)) ||
            _this.reportData?.isFilterHttpUrl?.(url)
          )
            return;
          const { responseType, response, status } = this;
          this.record_xhr.requestData = args[0];
          const eTime = getTimestamp();
          // 设置该接口的time，用户行为按时间排序
          this.record_xhr.time = this.record_xhr.sTime;
          this.record_xhr.Status = status;
          if (["", "json", "text"].indexOf(responseType) !== -1) {
            // 用户设置handleHttpStatus函数来判断接口是否正确，只有接口报错时才保留response
            if (_this.options?.handleHttpStatus?.call(_this, this.record_xhr)) {
              this.record_xhr.response = response && JSON.parse(response);
            }
          }
          // 接口的执行时长
          this.record_xhr.elapsedTime = eTime - this.record_xhr.sTime;
          _this.handleData(this.record_xhr, EVENT_TYPE.XHR);
        });
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
    replaceAop(_global, EVENT_TYPE.FETCH, (originalFetch: any) => {
      return function (url: any, config: Partial<Request> = {}): void {
        const sTime = getTimestamp();
        const method = (config && config.method) || "GET";
        let fetchData: any = {
          type: HTTP_TYPE.FETCH,
          method,
          requestData: config && config.body,
          url,
          response: "",
        };
        // 获取配置的headers；保留 setRequestHeader 别名以兼容旧的 beforeAppAjaxSend 用法
        const headers = new Headers(config.headers || {});
        (headers as any).setRequestHeader = headers.set.bind(headers);
        _this.options?.beforeAppAjaxSend?.({ method, url }, headers);

        config = Object.assign({}, config, { headers });
        return originalFetch.apply(_global, [url, config]).then(
          (res: any) => {
            // 克隆一份，防止被标记已消费
            const tempRes = res.clone();
            const eTime = getTimestamp();
            fetchData = Object.assign({}, fetchData, {
              elapsedTime: eTime - sTime,
              Status: tempRes.status,
              time: sTime,
            });
            tempRes.text().then((data: any) => {
              // 同理，对接口进行过滤
              if (
                (method === EMethods.Post &&
                  _this?.reportData?.isSdkTransportUrl(url)) ||
                _this?.reportData?.isFilterHttpUrl(url)
              )
                return;
              // 用户设置handleHttpStatus函数来判断接口是否正确，只有接口报错时才保留response
              if (_this.options?.handleHttpStatus?.(fetchData)) {
                fetchData.response = data;
              }
              // 修复：上报 fetchData（含 url/Status），而不是响应体字符串
              _this.handleData(fetchData, EVENT_TYPE.FETCH);
            }).catch(() => {
              // 读取响应体失败也要上报元数据（url/Status 已具备）
              _this.handleData(fetchData, EVENT_TYPE.FETCH);
            });
            return res;
          },
          // 接口报错（网络错误 / 被拒绝的 Promise）
          (err: any) => {
            const eTime = getTimestamp();
            if (
              (method === EMethods.Post &&
                _this.reportData?.isSdkTransportUrl(url)) ||
              _this.reportData?.isFilterHttpUrl(url)
            )
              return;
            const elapsedTime = eTime - sTime;
            fetchData = Object.assign({}, fetchData, {
              elapsedTime,
              // 修复：用大写 Status，与 handleData 的解构一致，否则网络错误永远识别不出来
              Status: 0,
              time: sTime,
            });
            _this.handleData(fetchData, EVENT_TYPE.FETCH);
            throw err;
          }
        );
      };
    });
    this.wrappedFetch = _global.fetch as voidFun;
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
    const timeoutThreshold = (this.options.overTime || 60) * 1000;
    const isTimeout = status === 0 && elapsedTime >= timeoutThreshold * 0.95;
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
      message =
        elapsedTime <= (this.options.overTime || 5) * 1000
          ? `请求失败，Status值为:${Status}`
          : "请求失败，接口超时";
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
        data: requestData || "",
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
