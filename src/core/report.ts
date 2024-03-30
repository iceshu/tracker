import { Queue } from "./queue";
import { Global } from "./global";
import { generateUUID, getLocationHref, isEmpty } from "../utils";
import { EVENT_TYPE } from "./constant";
import { Breadcrumb } from "./breadcrumb";
import { ReportData } from "./typing";
import { IPluginParams } from "../plugins/common";
import { IOptionsParams } from "./options";
export class ReportDataController {
  queue: Queue = new Queue(); // 消息队列
  apikey = ""; // 每个项目对应的唯一标识
  dns = ""; // 监控上报接口的地址
  userId = ""; // 用户id
  uuid: string; // 每次页面加载的唯一标识
  beforeDataReport: any; // 上报数据前的hook
  getUserId: any; // 用户自定义获取userId的方法
  useImgUpload = false; // 是否使用图片打点上报
  recordScreenId: any;
  breadcrumb: Breadcrumb;
  options: IOptionsParams;
  constructor(params: Omit<IPluginParams, "reportData">) {
    const { options, breadcrumb } = params;
    this.breadcrumb = breadcrumb;
    this.uuid = generateUUID();
    this.dns = options.dns;
    this.apikey = options?.apikey;
    this.options = options;
    this.beforeDataReport = options?.beforeDataReport;
  }
  beacon(url: string, data: any): boolean {
    return navigator.sendBeacon(url, JSON.stringify(data));
  }
  imgRequest(data: ReportData, url: string): void {
    const sendData = (imageUrl: string) => {
      const image = new Image();
      image.src = imageUrl;
    };
    sendData(
      `${url}${url.includes("?") ? "&" : "?"}data=${encodeURIComponent(
        JSON.stringify(data)
      )}`
    );
    this.queue.addFn(sendData);
  }

  async beforePost(this: any, data: ReportData): Promise<ReportData | boolean> {
    let transportData = this.getTransportData(data);
    // 配置了beforeDataReport
    if (typeof this.beforeDataReport === "function") {
      transportData = this.beforeDataReport(transportData);
      if (!transportData) return false;
    }
    return transportData;
  }
  async xhrPost(data: ReportData, url: string): Promise<void> {
    const requestFun = () => {
      fetch(`${url}`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        },
      });
    };
    this.queue.addFn(requestFun);
  }
  // 获取用户信息
  getAuthInfo() {
    return {
      userId: this.userId || this.getAuthId() || "",
      sdkVersion: "1.0.0",
      apikey: this.apikey,
    };
  }
  getAuthId(): string | number {
    if (typeof this.getUserId === "function") {
      const id = this.getUserId();
      if (typeof id === "string" || typeof id === "number") {
        return id;
      } else {
        console.error(
          `userId: ${id} 期望 string 或 number 类型，但是传入 ${typeof id}`
        );
      }
    }
    return "";
  }
  // 添加公共信息
  // 这里不要添加时间戳，比如接口报错，发生的时间和上报时间不一致
  getTransportData(data: any): ReportData {
    const info = {
      ...data,
      userInfo: this.getAuthInfo(), // 获取用户信息
      uuid: this.uuid,
      releaseVersion: this.options?.version,
      pageUrl: getLocationHref(),
      deviceInfo: Global.deviceInfo, // 获取设备信息
    };

    // 性能数据、录屏、白屏检测等不需要附带用户行为
    const excludeBreadcrumb = [
      EVENT_TYPE.PERFORMANCE,
      EVENT_TYPE.RECORDSCREEN,
      EVENT_TYPE.WHITESCREEN,
    ];
    if (!excludeBreadcrumb.includes(data.type)) {
      info.breadcrumb = this.breadcrumb.getStack(); // 获取用户行为栈
    }
    return info;
  }
  // 判断请求是否为SDK配置的接口
  isSdkTransportUrl(targetUrl: string): boolean {
    let isSdkDsn = false;
    if (this.dns && targetUrl.indexOf(this.dns) !== -1) {
      isSdkDsn = true;
    }
    return isSdkDsn;
  }
  isFilterHttpUrl(url: string): boolean {
    return !!(
      this.options.filterXhrUrlRegExp &&
      this.options.filterXhrUrlRegExp.test(url)
    );
  }
  // 上报数据
  async send(data: any) {
    const dsn = this.dns;
    if (isEmpty(dsn)) {
      console.error("dsn为空，没有传入监控错误上报的dsn地址，请在init中传入");
      return;
    }

    const result = (await this.beforePost(data)) as ReportData;
    if (result) {
      // 优先使用sendBeacon 上报，若数据量大，再使用图片打点上报和fetch上报
      const value = this.beacon(dsn, result);
      if (!value) {
        return this.useImgUpload
          ? this.imgRequest(result, dsn)
          : this.xhrPost(result, dsn);
      }
    }
  }
}
