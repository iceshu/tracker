import { Breadcrumb } from "../core/breadcrumb";
import { ReportDataController } from "../core/report";
import { BreadcrumbItem } from "./breadcrumb";
import { ReportData } from "./common";
import { IOptionsParams } from "./options";

export abstract class BasePlugin {
    protected client: BaseClient;
    abstract name: string;

    constructor(client: BaseClient) {
        this.client = client;
    }

    // 插件生命周期钩子
    setup?(): void;
    beforeAddBreadcrumb?(breadcrumb: BreadcrumbItem): BreadcrumbItem | null;
    beforeReport?(data: ReportData): ReportData | null;
    afterReport?(data: ReportData): void;
}

export abstract class BaseClient {
    #breadcrumb: Breadcrumb;
    #options: IOptionsParams;
    #plugins: BasePlugin[] = [];
    #reportData: ReportDataController;
    #registeredPlugins: WeakMap<any, any>;

    constructor(options: IOptionsParams, plugins: BasePlugin[]) {
        this.#options = options;
        this.#plugins = plugins;
        this.#registeredPlugins = new Map();
        const { maxBreadcrumbs, beforePushBreadcrumb } = options;
        this.#breadcrumb = new Breadcrumb(maxBreadcrumbs, beforePushBreadcrumb);
        this.#reportData = new ReportDataController({
            options,
            breadcrumb: this.#breadcrumb,
        });
        this.initializePlugins(plugins);

    }

    initializePlugins(plugins: BasePlugin[]): void {
        const PluginPrams = {
            breadcrumb: this.#breadcrumb,
            options: this.#options,
            reportData: this.#reportData,
        };
        plugins.map((Plugin: any) => {
            const plugin = new Plugin(PluginPrams);
            this.#registeredPlugins.set(plugin.name, plugin);
        });
    }

    // 抽象方法：必须由子类实现
    protected abstract send(data: ReportData): Promise<void>;

    // 可以被重写的方法
    protected beforeAddBreadcrumb(breadcrumb: BreadcrumbItem): BreadcrumbItem | null {
        return breadcrumb;
    }

    protected beforeReport(data: ReportData): ReportData | null {
        return data;
    }

    getOptions(): Readonly<IOptionsParams> {
        return { ...this.#options };
    }

    getPlugin<T extends BasePlugin>(name: string): T | undefined {
        return this.#registeredPlugins.get(name) as T;
    }
}