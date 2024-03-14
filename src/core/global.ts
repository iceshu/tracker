import { UAParser } from "ua-parser-js";

export class Global {
  _global: any;
  deviceInfo: any;
  errorMap: WeakMap<any, any> = new WeakMap();
  constructor(global: (Window & typeof globalThis) | undefined) {
    const uaResult = new UAParser().getResult();
    this.deviceInfo = {
      browserVersion: uaResult.browser.version, // // 浏览器版本号 107.0.0.0
      browser: uaResult.browser.name, // 浏览器类型 Chrome
      osVersion: uaResult.os.version, // 操作系统 电脑系统 10
      os: uaResult.os.name, // Windows
      ua: uaResult.ua,
      device: uaResult.device.model ? uaResult.device.model : "Unknow",
      device_type: uaResult.device.type ? uaResult.device.type : "Pc",
    };
    this._global = global;
  }
}
export const global = new Global(window);
