import { readonly } from "../utils";
import { Breadcrumb } from "./breadcrumb";
import { Global } from "./global";
import { IOptionsParams } from "./options";
import { ReportDataController } from "./report";

export class BaseClient {
  protected reportData: ReportDataController;
  protected plugins: Array<any>;
  protected options: IOptionsParams;
  protected breadcrumb: Breadcrumb;

  constructor(options: IOptionsParams, plugins: Array<any>) {
    this.options = readonly(options);
    this.plugins = plugins;
    const { maxBreadcrumbs = 20, beforePushBreadcrumb } = options;
    this.breadcrumb = new Breadcrumb(maxBreadcrumbs, beforePushBreadcrumb);
    this.reportData = new ReportDataController({
      options,
      breadcrumb: this.breadcrumb,
    });
    Global.options = options;
    Global.breadcrumb = this.breadcrumb;
    Global.reportData = this.reportData;
    this.setupPlugins();
  }

  protected setupPlugins() {
    const PluginPrams = {
      breadcrumb: this.breadcrumb,
      options: this.options,
      reportData: this.reportData,
    };
    Global.plugins = this.plugins.map((Plugin: any) => new Plugin(PluginPrams));
  }
}
