/**
 * 事件类型
 */
export enum EVENT_TYPE {
  XHR = "xhr",
  FETCH = "fetch",
  CLICK = "click",
  HISTORY = "history",
  ERROR = "error",
  HASHCHANGE = "hashchange",
  UNHANDLEDREJECTION = "unhandledrejection",
  RESOURCE = "resource",
  DOM = "dom",
  VUE = "vue",
  REACT = "react",
  CUSTOM = "custom",
  PERFORMANCE = "performance",
  RECORDSCREEN = "recordScreen",
  WHITESCREEN = "whiteScreen",
  CONSOLE = "console",
}
export enum BREADCRUMB_TYPE {
  HTTP = "Http",
  CLICK = "Click",
  RESOURCE = "Resource_Error",
  CODE_ERROR = "Code_Error",
  ROUTE = "Route",
  CUSTOM = "Custom",
  CONSOLE = "console",
}
export enum STATUS_CODE {
  ERROR = "error",
  OK = "ok",
}
/**
 * 接口错误状态
 */
export enum SpanStatus {
  Ok = "ok",
  DeadlineExceeded = "deadline_exceeded",
  Unauthenticated = "unauthenticated",
  PermissionDenied = "permission_denied",
  NotFound = "not_found",
  ResourceExhausted = "resource_exhausted",
  InvalidArgument = "invalid_argument",
  Unimplemented = "unimplemented",
  Unavailable = "unavailable",
  InternalError = "internal_error",
  UnknownError = "unknown_error",
  Cancelled = "cancelled",
  AlreadyExists = "already_exists",
  FailedPrecondition = "failed_precondition",
  Aborted = "aborted",
  OutOfRange = "out_of_range",
  DataLoss = "data_loss",
}
export enum HTTP_CODE {
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
}
export enum EMethods {
  Get = "GET",
  Post = "POST",
  Put = "PUT",
  Delete = "DELETE",
}

export enum PLUGIN_TYPE {
  CONSOLE_PLUGIN = "CONSOLE_PLUGIN",
  ERROR_PLUGIN = "ERROR_PLUGIN",
  DOM_PLUGIN = "DOM_PLUGIN",
  HISTORY_PLUGIN = "HISTORY_PLUGIN",
  PERFORMANCE_PLUGIN = "PERFORMANCE_PLUGIN",
}
