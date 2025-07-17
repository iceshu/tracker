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

// 请求数据接口
interface RequestRecord {
  method: string;
  url: string;
  sTime: number;
  type: string;
  requestData?: any;
  time?: number;
  Status?: number;
  response?: any;
  elapsedTime?: number;
}

// 错误处理结果接口
interface ErrorResult {
  url: string;
  time: number;
  status: STATUS_CODE;
  elapsedTime: number;
  message: string;
  requestData: {
    httpType: string;
    method: string;
    data: any;
  };
  response: {
    Status: number;
    data: any;
  };
}

export class RequestPlugin {
  name = PLUGIN_TYPE.REQUEST_PLUGIN;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;

  constructor(params: IPluginParams) {
    const { options, breadcrumb, reportData } = params;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }

  setup() {
    this.xhrReplace();
    this.fetchReplace();
  }

  /**
   * 检查URL是否应该被过滤
   */
  private shouldFilterUrl(method: string, url: string): boolean {
    return (
      (method === EMethods.Post && this.reportData?.isSdkTransportUrl?.(url)) ||
      this.reportData?.isFilterHttpUrl?.(url)
    );
  }

  /**
   * 检查是否为错误状态
   */
  private isErrorStatus(status: number): boolean {
    return (
      status === 0 ||
      status === HTTP_CODE.BAD_REQUEST ||
      status > HTTP_CODE.UNAUTHORIZED
    );
  }

  /**
   * 安全地解析JSON
   */
  private safeJsonParse(data: any): any {
    if (!data) return null;
    try {
      return typeof data === "string" ? JSON.parse(data) : data;
    } catch (error) {
      return data;
    }
  }

  /**
   * 处理响应数据
   */
  private processResponse(record: RequestRecord, response: any, responseType: string): void {
    if (["", "json", "text"].indexOf(responseType) !== -1) {
      if (this.options?.handleHttpStatus?.call(this, record)) {
        record.response = this.safeJsonParse(response);
      }
    }
  }

  /**
   * 统一处理请求数据
   */
  private handleRequestData(record: RequestRecord, type: EVENT_TYPE): void {
    const { url, Status = 200 } = record;
    
    if (!url) return;

    const isError = this.isErrorStatus(Status);
    const result = this.transformRequestData(record);

    // 添加到面包屑（排除上报接口）
    if (!url.includes(this.options.dsn)) {
      const category = this.breadcrumb.getCategory(type);
      this.breadcrumb.push({
        type,
        category,
        data: { ...result },
        time: record.time!,
        status: STATUS_CODE.OK,
      });
    }

    // 如果是错误，上报错误信息
    if (isError) {
      this.reportError(record, type, result);
    }
  }

  /**
   * 上报错误信息
   */
  private reportError(record: RequestRecord, type: EVENT_TYPE, result: ErrorResult): void {
    this.breadcrumb.push({
      type,
      category: this.breadcrumb.getCategory(type),
      data: { ...result },
      time: record.time!,
      status: STATUS_CODE.ERROR,
    });

    this.reportData.send({
      type,
      category: this.breadcrumb.getCategory(type),
      data: { ...result },
      time: record.time!,
      name: "httpError",
      status: STATUS_CODE.ERROR,
    });
  }

  /**
   * 转换请求数据为标准格式
   */
  private transformRequestData(data: RequestRecord): ErrorResult {
    const {
      elapsedTime = 0,
      time = 0,
      method = "",
      type,
      Status = 200,
      response,
      requestData,
      url,
    } = data;

    let status: STATUS_CODE;
    let message: string;

    if (Status === 0) {
      status = STATUS_CODE.ERROR;
      const timeout = (this.options.overTime || 5) * 1000;
      message = elapsedTime <= timeout
        ? `请求失败，Status值为:${Status}`
        : "请求失败，接口超时";
    } else if (Status < HTTP_CODE.BAD_REQUEST) {
      status = STATUS_CODE.OK;
      
      if (this.options.handleHttpStatus && typeof this.options.handleHttpStatus === "function") {
        if (this.options.handleHttpStatus(data)) {
          status = STATUS_CODE.OK;
        } else {
          status = STATUS_CODE.ERROR;
          message = `接口报错，报错信息为：${
            typeof response === "object" ? JSON.stringify(response) : response
          }`;
        }
      }
    } else {
      status = STATUS_CODE.ERROR;
      message = `请求失败，Status值为:${Status}，${fromHttpStatus(Status)}`;
    }

    return {
      url,
      time,
      status,
      elapsedTime,
      message: `${url}; ${message || ""}`,
      requestData: {
        httpType: type as string,
        method,
        data: requestData || "",
      },
      response: {
        Status,
        data: status === STATUS_CODE.ERROR ? response : null,
      },
    };
  }

  xhrReplace(): void {
    const _this = this;
    if (!("XMLHttpRequest" in _global)) {
      return;
    }

    const originalXhrProto = XMLHttpRequest.prototype;

    // 重写open方法
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

    // 重写send方法
    replaceAop(originalXhrProto, "send", (originalSend: voidFun) => {
      return function (this: any, ...args: any[]): void {
        const { method, url } = this.record_xhr;
        
        // 监听loadend事件，接口成功或失败都会执行
        addEventListenerTo(this, "loadend", function (this: any) {
          const { responseType, response, status } = this;
          
          // 检查是否需要过滤
          if (_this.shouldFilterUrl(method, url)) return;

          // 更新请求记录
          this.record_xhr.requestData = args[0];
          this.record_xhr.time = this.record_xhr.sTime;
          this.record_xhr.Status = status;
          this.record_xhr.elapsedTime = getTimestamp() - this.record_xhr.sTime;

          // 处理响应数据
          _this.processResponse(this.record_xhr, response, responseType);
          
          // 处理请求数据
          _this.handleRequestData(this.record_xhr, EVENT_TYPE.XHR);
        });

        originalSend.apply(this, args);
      };
    });
  }

  fetchReplace(): void {
    const _this = this;
    if (!("fetch" in _global)) {
      return;
    }

    replaceAop(_global, EVENT_TYPE.FETCH, (originalFetch: any) => {
      return function (url: any, config: Partial<Request> = {}): Promise<Response> {
        const sTime = getTimestamp();
        const method = (config?.method || "GET").toUpperCase();
        
        // 检查是否需要过滤
        if (_this.shouldFilterUrl(method, url)) {
          return originalFetch.apply(_global, [url, config]);
        }

        let fetchData: RequestRecord = {
          type: HTTP_TYPE.FETCH,
          method,
          requestData: config?.body,
          url,
          response: "",
          sTime,
        };

        // 处理请求头
        const headers = new Headers(config.headers || {});
        Object.assign(headers, {
          setRequestHeader: headers.set,
        });
        _this.options?.beforeAppAjaxSend?.({ method, url }, headers);

        const updatedConfig = Object.assign({}, config, headers);

        return originalFetch.apply(_global, [url, updatedConfig])
          .then((res: Response) => {
            // 克隆响应，防止被标记已消费
            const tempRes = res.clone();
            const eTime = getTimestamp();
            
            fetchData = {
              ...fetchData,
              elapsedTime: eTime - sTime,
              Status: tempRes.status,
              time: sTime,
            };

            return tempRes.text().then((data: string) => {
              // 处理响应数据
              _this.processResponse(fetchData, data, "text");
              _this.handleRequestData(fetchData, EVENT_TYPE.FETCH);
              return res;
            });
          })
          .catch((err: any) => {
            const eTime = getTimestamp();
            
            fetchData = {
              ...fetchData,
              elapsedTime: eTime - sTime,
              Status: 0,
              time: sTime,
            };

            _this.handleRequestData(fetchData, EVENT_TYPE.FETCH);
            throw err;
          });
      };
    });
  }

  // 为了保持向后兼容，保留原有的方法名
  handleData(xhrData: any, type: EVENT_TYPE) {
    this.handleRequestData(xhrData, type);
  }

  handleTransForm(data: HttpData) {
    return this.transformRequestData(data as RequestRecord);
  }
}
