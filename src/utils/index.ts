export * from "./httpStatus";
export * from "./bowers";
export const getTimestamp = (): number => Date.now();
export function generateUUID(): string {
  let d = new Date().getTime();
  const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    function (c) {
      const r = (d + Math.random() * 16) % 16 | 0;
      d = Math.floor(d / 16);
      return (c == "x" ? r : (r & 0x3) | 0x8).toString(16);
    }
  );
  return uuid;
}
export function addEventListenerTo(
  target: EventTarget,
  eventName: string,
  handler: EventListener,
  options?: boolean | AddEventListenerOptions
) {
  target.addEventListener(eventName, handler, options);
}
export const throttle = (fn: any, delay: number) => {
  let canRun = true;
  return function (this: any, ...args: any[]) {
    if (!canRun) return;
    fn.apply(this, args);
    canRun = false;
    setTimeout(() => {
      canRun = true;
    }, delay);
  };
};
export function isEmpty(value: any) {
  if (value == null) {
    return true;
  }
  if (typeof value === "object" && Object.keys(value).length === 0) {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  if (typeof value === "string" && value.trim() === "") {
    return true;
  }
  return false;
}
export function isString(value: any): value is string {
  return typeof value === "string";
}
export function isUndefined(value: any): value is undefined {
  return typeof value === "undefined";
}
export const readonly = (rawObject: any) =>
  new Proxy(rawObject, {
    set(target, prop, value) {
      throw new Error(`Property '${String(prop)}' is read-only`);
    },
  });
export function isObject(value: any): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function getLocationHref(): string {
  if (typeof document === "undefined" || document.location == null) return "";
  return document.location.href;
}
/**
 * 重写对象上面的某个属性
 * @param source 需要被重写的对象
 * @param name 需要被重写对象的key
 * @param replacement 以原有的函数作为参数，执行并重写原有函数
 * @param isForced 是否强制重写（可能原先没有该属性）
 */
export function replaceAop(
  source: any,
  name: string,
  replacement: any,
  isForced = false
) {
  if (source === undefined) return;
  if (name in source || isForced) {
    const original = source[name];
    const wrapped = replacement(original);
    if (typeof wrapped === "function") {
      source[name] = wrapped;
    }
  }
}
