import { Breadcrumb } from "../core/breadcrumb";
import { BREADCRUMB_TYPE, EVENT_TYPE, STATUS_CODE } from "../core/constant";
import { Global } from "../core/global";
import { ReportDataController } from "../core/report";
import {
  addEventListenerTo,
  getTimestamp,
  htmlElementAsString,
  throttle,
} from "../utils";
import { IPluginParams, ReplacePlugin } from "./common";

export class DomPlugin {
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
    this.replace();
  }
  replace(): void {
    if (!("document" in this.global._global)) return;
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
    }, this.options.throttleDelayTime);

    addEventListenerTo(
      this.global._global.document,
      "click",
      function (this: any): void {
        clickThrottle(this);
      },
      true
    );
  }
}
