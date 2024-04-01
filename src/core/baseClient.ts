import { getTimestamp, readonly } from "../utils";
import { Breadcrumb } from "./breadcrumb";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE } from "./constant";
import { Global } from "./global";
import { IOptionsParams } from "./options";
import { ReportDataController } from "./report";

export class BaseClient {
  #reportData: ReportDataController;
  #plugins: Array<any>;
  #options: IOptionsParams;
  #breadcrumb: Breadcrumb;
  #registeredPlugins: WeakMap<any, any>;
  constructor(options: IOptionsParams, plugins: Array<any>) {
    this.#options = readonly(options);
    this.#plugins = plugins;
    this.#registeredPlugins = new Map();
    const { maxBreadcrumbs = 20, beforePushBreadcrumb } = options;
    this.#breadcrumb = new Breadcrumb(maxBreadcrumbs, beforePushBreadcrumb);
    this.#reportData = new ReportDataController({
      options,
      breadcrumb: this.#breadcrumb,
    });
    Global.options = options;
    Global.breadcrumb = this.#breadcrumb;
    Global.reportData = this.#reportData;
    this.#setupPlugins();
  }
  get breadcrumbList() {
    return this.#breadcrumb;
  }
  log(value: any) {
    this.#reportData?.send({
      type: EVENT_TYPE.CUSTOM,
      status: STATUS_CODE.OK,
      name: EVENT_TYPE.CUSTOM,
      data: {
        value,
      },
      time: getTimestamp(),
    });
  }

  errorBoundary(err: Error) {
    const errorPlugin = this.#registeredPlugins.get(PLUGIN_TYPE.ERROR_PLUGIN);
    errorPlugin?.handleError(err);
  }

  #setupPlugins() {
    const PluginPrams = {
      breadcrumb: this.#breadcrumb,
      options: this.#options,
      reportData: this.#reportData,
    };
    Global.plugins = this.#plugins.map((Plugin: any) => {
      const plugin = new Plugin(PluginPrams);
      this.#registeredPlugins.set(plugin.name, plugin);
    });
  }
}
