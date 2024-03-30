import { Breadcrumb } from "../core/breadcrumb";
import {
  BREADCRUMB_TYPE,
  EVENT_TYPE,
  PLUGIN_TYPE,
  STATUS_CODE,
} from "../core/constant";
import { Global, _global } from "../core/global";
import { IOptionsParams } from "../core/options";
import { ReportDataController } from "../core/report";
import {
  addEventListenerTo,
  getTimestamp,
  htmlElementAsString,
  throttle,
} from "../utils";
import { IPluginParams, ReplacePlugin } from "./common";
import { UAParser } from "ua-parser-js";

export class DomPlugin implements ReplacePlugin {
  name = PLUGIN_TYPE.DOM_PLUGIN;
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
    this.initDeviceInfo();
    this.replace();
  }
  initDeviceInfo() {
    const uaResult = new UAParser().getResult();
    Global.deviceInfo = {
      browserVersion: uaResult.browser.version, // // 浏览器版本号 107.0.0.0
      browser: uaResult.browser.name, // 浏览器类型 Chrome
      osVersion: uaResult.os.version, // 操作系统 电脑系统 10
      os: uaResult.os.name, // Windows
      ua: uaResult.ua,
      device: uaResult.device.model ? uaResult.device.model : "Unknow",
      device_type: uaResult.device.type ? uaResult.device.type : "Pc",
    };
  }
  replace(): void {
    if (!("document" in _global)) return;
    // 节流，默认0s
    const clickThrottle = throttle((data: any) => {
      const htmlString = htmlElementAsString(data.activeElement as HTMLElement);
      if (htmlString) {
        this.breadcrumb.push({
          type: EVENT_TYPE.CLICK,
          category: BREADCRUMB_TYPE.CLICK,
          data: htmlString,
          time: getTimestamp(),
          status: STATUS_CODE.OK,
        });
      }
    }, this.options.throttleDelayTime || 0);

    addEventListenerTo(
      _global.document,
      "click",
      function (this: any): void {
        clickThrottle(this);
      },
      true
    );
  }
}
