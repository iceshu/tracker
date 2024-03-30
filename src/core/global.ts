import { Breadcrumb } from "./breadcrumb";
import { IOptionsParams } from "./options";

export const _global = window;
export class Global {
  static deviceInfo: any;
  static breadcrumb?: Breadcrumb;
  static options?: IOptionsParams;
  static plugins: any;
  static reportData: any;

  static errorBoundary(err: Error) {
    const errorPlugin = this.plugins?.find(
      (item: { name: string }) => item.name === "ERROR_PLUGIN"
    );
    errorPlugin?.handleError(err);
  }
}
