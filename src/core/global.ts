import { Breadcrumb } from "./breadcrumb";
import { ReportDataController } from "./report";

export const _global = window;
export class Global {
  _global: any;
  deviceInfo: any;
  breadcrumb?: Breadcrumb;
  reportData?: ReportDataController;
  options?: IOptionsParams;
  constructor() {
    this.setup();
  }
  setup() {}
  log(data: any) {
    this.reportData?.send(data);
  }
}
export const global = new Global();
