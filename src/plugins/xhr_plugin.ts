import { Breadcrumb } from "../core/breadcrumb";
import { EMethods, EVENT_TYPE, HTTP_CODE, STATUS_CODE } from "../core/constant";
import { Global } from "../core/global";
import { ReportDataController } from "../core/report";
import { HttpData } from "../core/typing";
import { addEventListenerTo, fromHttpStatus, getTimestamp } from "../utils";
import { HTTP_TYPE, IPluginParams } from "./common";
import { ReplacePlugin } from "./common";
class XhrPlugin {
  global: Global;
  options: IOptionsParams;
  breadcrumb: Breadcrumb;
  reportData: ReportDataController;
  constructor(params: IPluginParams) {
    const { global, options, breadcrumb, reportData } = params;
    this.global = global;
    this.options = options;
    this.breadcrumb = breadcrumb;
    this.reportData = reportData;
    this.setup();
  }
  setup() {
    this.replaceXhr();
    this.replaceFetch();
  }
  replaceXhr(): void {
    if (!("XMLHttpRequest" in this.global._global)) {
      return;
    }
    const that = this;

    const proxyObj = new Proxy(this.global._global.XMLHttpRequest, {
      construct(target: any, args: any[]) {
        const xhr = new target(...args);
        return new Proxy(xhr, {
          get(target: any, prop: string, receiver: any) {
            if (prop === "open") {
              return (method: string, url: string) => {
                target.__xhr = {
                  method: method.toUpperCase(),
                  url,
                  sTime: getTimestamp(),
                  type: HTTP_TYPE.XHR,
                };
                return Reflect.get(target, prop, receiver).apply(
                  this,
                  arguments
                );
              };
            }
            if (prop === "send") {
              return (data: any) => {
                addEventListenerTo(xhr, "loadend", () => {
                  const { responseType, status } = xhr;
                  target.__xhr.requestData = data;
                  target.__xhr.time = target.__xhr.sTime;
                  target.__xhr.Status = status;
                  if (["", "json", "text"].indexOf(responseType) > -1) {
                    target.__xhr.response =
                      xhr.response && JSON.parse(xhr.response);
                  }
                  target.__xhr.elapsedTime =
                    getTimestamp() - target.__xhr.sTime;
                  that.handleData(target.__xhr);
                });
                return Reflect.get(target, prop, receiver).apply(
                  this,
                  arguments
                );
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      },
    });
    this.global._global.XMLHttpRequest = proxyObj;
  }
  replaceFetch() {
    const { _global } = this.global;
    if (!("fetch" in _global)) {
      return;
    }

    const fetchProxy = new Proxy(_global.fetch, {
      apply: (target, thisArg, args) => {
        const [url, config = {}] = args;
        const sTime = getTimestamp();
        const method = config.method || "GET";
        let fetchData = {
          type: HTTP_TYPE.FETCH,
          method,
          requestData: config.body,
          url,
          response: "",
        };

        // 添加自定义逻辑
        return target.apply(_global, args).then(
          (res: any) => {
            const tempRes = res.clone();
            const eTime = getTimestamp();
            fetchData = Object.assign({}, fetchData, {
              elapsedTime: eTime - sTime,
              Status: tempRes.status,
              time: sTime,
            });
            tempRes.text().then((data: any) => {
              // 自定义逻辑
              // 判断是否需要过滤或处理接口数据
              if (
                (method === EMethods.Post &&
                  this.reportData.isSdkTransportUrl(url)) ||
                this.reportData.isFilterHttpUrl(url)
              )
                return;

              this.handleData(fetchData);
            });
            return res;
          },
          (err: any) => {
            const eTime = getTimestamp();
            if (
              (method === EMethods.Post &&
                this.reportData.isSdkTransportUrl(url)) ||
              this.reportData.isFilterHttpUrl(url)
            )
              return;
            fetchData = Object.assign({}, fetchData, {
              elapsedTime: eTime - sTime,
              status: 0,
              time: sTime,
            });
            this.handleData(fetchData);
            throw err;
          }
        );
      },
    });
    // 用代理对象替换原有的 fetch 方法
    _global.fetch = fetchProxy;
  }
  handleData(xhrData: any) {
    const { url } = xhrData;
    if (!url.includes(this.options.dsn)) {
      const result = this.handleTransForm(xhrData);
      const category = this.breadcrumb.getCategory(xhrData.type! as EVENT_TYPE);
      this.breadcrumb.push({
        type: EVENT_TYPE.FETCH,
        category,
        data: result,
        time: xhrData.time,
        status: result.status,
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
export default XhrPlugin;
