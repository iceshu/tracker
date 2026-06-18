import { BasePlugin } from "../typings/base";
import { IOptionsParams } from "../typings/options";
import { getTimestamp, readonly } from "../utils";
import { Breadcrumb } from "./breadcrumb";
import { EVENT_TYPE, PLUGIN_TYPE, STATUS_CODE, DEFAULTS } from "./constant";
import { Global } from "./global";
import { ReportDataController } from "./report";

type ErrorBoundaryPlugin = BasePlugin & {
  handleError?(err: Error): void;
  handleReactError?(
    error: Error,
    errorInfo?: { componentStack?: string; digest?: string }
  ): void;
};

export class BaseBrowserClient {
  #breadcrumb: Breadcrumb;
  #options: IOptionsParams;
  #reportData: ReportDataController;
  #registeredPlugins: Map<string, BasePlugin>;
  #baseDeviceInfo = {};
  constructor(options: IOptionsParams, plugins: BasePlugin[]) {
    // 浏览器环境无 process，用 globalThis 安全读取，避免 UMD 下 ReferenceError；测试态保留可变 options
    const isTestEnv =
      (globalThis as any)?.process?.env?.NODE_ENV === "test";
    this.#options = isTestEnv ? options : readonly(options);
    this.#registeredPlugins = new Map();
    const { maxBreadcrumbs = DEFAULTS.MAX_BREADCRUMBS, beforePushBreadcrumb } =
      options;
    this.#breadcrumb = new Breadcrumb(maxBreadcrumbs, beforePushBreadcrumb);
    this.#reportData = new ReportDataController({
      options,
      breadcrumb: this.#breadcrumb,
    });

    Global.options = options;
    Global.breadcrumb = this.#breadcrumb;
    Global.reportData = this.#reportData;
    this.initializePlugins(plugins);
  }

  protected initializePlugins(plugins: BasePlugin[]): void {
    const PluginPrams = {
      breadcrumb: this.#breadcrumb,
      options: this.#options,
      reportData: this.#reportData,
      baseDeviceInfo: this.#baseDeviceInfo,
      setBaseDeviceInfo: (deviceInfo: any) => {
        this.#baseDeviceInfo = deviceInfo;
      },
    };
    Global.plugins = plugins.map((Plugin: any) => {
      const plugin = new Plugin(PluginPrams);
      this.#registeredPlugins.set(plugin.name, plugin);
      return plugin;
    });
  }
  getOptions(): Readonly<IOptionsParams> {
    return this.#options;
  }

  getPlugin(name: string) {
    return this.#registeredPlugins.get(name);
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
    const errorPlugin = this.#registeredPlugins.get(
      PLUGIN_TYPE.ERROR_PLUGIN
    ) as ErrorBoundaryPlugin | undefined;
    errorPlugin?.handleError?.(err);
  }

  // React/Next 错误边界专用上报（携带组件栈、digest）
  captureReactError(
    error: Error,
    errorInfo?: { componentStack?: string; digest?: string }
  ) {
    const errorPlugin = this.#registeredPlugins.get(
      PLUGIN_TYPE.ERROR_PLUGIN
    ) as ErrorBoundaryPlugin | undefined;
    errorPlugin?.handleReactError?.(error, errorInfo);
  }

  // 卸载所有插件副作用（监听器、AOP 改写、定时器），供框架卸载时调用
  destroy() {
    this.#registeredPlugins.forEach((plugin) => {
      try {
        plugin.destroy?.();
      } catch (e) {
        console.error("Plugin destroy error:", e);
      }
    });
    this.#registeredPlugins.clear();
    Global.plugins = [];
  }
}
