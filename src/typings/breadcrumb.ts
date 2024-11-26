import { BREADCRUMB_TYPE, EVENT_TYPE, STATUS_CODE } from "../core/constant";

export interface BreadcrumbItem {
    type: EVENT_TYPE; // 事件类型
    category: BREADCRUMB_TYPE; // 用户行为类型
    status: STATUS_CODE; // 行为状态
    time: number; // 发生时间
    data: any;
    level?: string; // 用户行为等级
}
