import { Breadcrumb } from "../core/breadcrumb";
import {
  BREADCRUMB_TYPE,
  EMethods,
  EVENT_TYPE,
  HTTP_CODE,
  STATUS_CODE,
} from "../core/constant";
import { _global } from "../core/global";
import { IOptionsParams } from "../core/options";
import { ReportDataController } from "../core/report";
import { HttpData, TRACKERHttpRequest, voidFun } from "../core/typing";
import {
  addEventListenerTo,
  fromHttpStatus,
  getTimestamp,
  isString,
  replaceAop,
} from "../utils";
import { HTTP_TYPE, IPluginParams } from "./common";
export class RequestPlugin {
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
  xhrReplace(): void {
    const _this = this;
    if (!("XMLHttpRequest" in _global)) {
      return;
    }
    const originalXhrProto = XMLHttpRequest.prototype;
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
            _this.reportData?.isSdkTransportUrl?.(url)
          )
            return;
          const { responseType, response, status } = this;
          this.record_xhr.requestData = args[0];
          const eTime = getTimestamp();
          // 设置该接口的time，用户用户行为按时间排序
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
          // 执行之前注册的xhr回调函数
          _this.handleData(this.record_xhr, EVENT_TYPE.XHR);
        });
        originalSend.apply(this, args);
      };
    });
  }

  fetchReplace() {
    const _this = this;
    if (!("fetch" in _global)) {
      return;
    }
    replaceAop(_global, EVENT_TYPE.FETCH, (originalFetch: any) => {
      return function (url: any, config: Partial<Request> = {}): void {
        const sTime = getTimestamp();
        const method = (config && config.method) || "GET";
        let fetchData = {
          type: HTTP_TYPE.FETCH,
          method,
          requestData: config && config.body,
          url,
          response: "",
        };
        // 获取配置的headers
        const headers = new Headers(config.headers || {});
        Object.assign(headers, {
          setRequestHeader: headers.set,
        });
        _this.options?.beforeAppAjaxSend?.({ method, url }, headers);

        config = Object.assign({}, config, headers);
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
              // 同理，进接口进行过滤
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
              _this.handleData(data, EVENT_TYPE.FETCH);
            });
            return res;
          },
          // 接口报错
          (err: any) => {
            const eTime = getTimestamp();
            if (
              (method === EMethods.Post &&
                _this.reportData?.isSdkTransportUrl(url)) ||
              _this.reportData?.isFilterHttpUrl(url)
            )
              return;
            fetchData = Object.assign({}, fetchData, {
              elapsedTime: eTime - sTime,
              status: 0,
              time: sTime,
            });
            _this.handleData(fetchData, EVENT_TYPE.FETCH);
            throw err;
          }
        );
      };
    });
  }
  handleData(xhrData: any, type: EVENT_TYPE) {
    const { url, Status } = xhrData;
    const isError =
      Status === 0 ||
      Status === HTTP_CODE.BAD_REQUEST ||
      Status > HTTP_CODE.UNAUTHORIZED;
    const result = this.handleTransForm(xhrData);
    if (!url.includes(this.options.dsn)) {
      const category = this.breadcrumb.getCategory(type);
      this.breadcrumb.push({
        type: type,
        category,
        data: { ...result },
        time: xhrData.time,
        status: STATUS_CODE.OK,
      });
    }
    if (isError) {
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
        elapsedTime <= this.options.overTime * 1000
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
}
