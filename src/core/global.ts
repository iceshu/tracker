import { Breadcrumb } from "./breadcrumb";
import { IOptionsParams } from "./options";
import { ReportDataController } from "./report";

export const _global = window;
export class Global {
  deviceInfo: any;
  breadcrumb?: Breadcrumb;
  reportData?: ReportDataController;
  options?: IOptionsParams;
  static plugins: any;
  static reportData: any;
  constructor() {
    this.setup();
  }
  setup() {}
  static log(data: any) {
    this.reportData?.send(data);
  }
  static errorBoundary(err: Error) {
    const errorPlugin = this.plugins?.find(
      (item: { name: string }) => item.name === "ERROR_PLUGIN"
    );
    errorPlugin?.handleError(err);
  }
}
export const global = new Global();
