export * from "./httpStatus";
export * from "./bowers";

/**
 * 获取当前时间戳
 * @returns 当前时间的毫秒级时间戳
 */
export const getTimestamp = (): number => Date.now();

/**
 * 生成符合 UUID v4 标准的唯一标识符
 * 优先使用 crypto API，降级使用随机数生成
 * @returns UUID v4 格式的字符串
 */
export function generateUUID(): string {
  // 优先使用现代浏览器的 crypto API
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // 降级方案：生成 UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
/**
 * 为目标对象添加事件监听器，包含错误处理
 * @param target 事件目标对象
 * @param eventName 事件名称
 * @param handler 事件处理函数
 * @param options 事件监听选项
 */
export function addEventListenerTo(
  target: EventTarget,
  eventName: string,
  handler: EventListener,
  options?: boolean | AddEventListenerOptions
): void {
  try {
    target.addEventListener(eventName, handler, options);
  } catch (error) {
    console.error(`Failed to add ${eventName} listener:`, error);
  }
}
/**
 * 节流函数：在指定时间间隔内只执行一次函数
 * @param fn 需要节流的函数
 * @param delay 节流时间间隔（毫秒）
 * @returns 节流后的函数
 * @example
 * const throttledScroll = throttle(() => console.log('scroll'), 200);
 * window.addEventListener('scroll', throttledScroll);
 */
export const throttle = <T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): ((this: any, ...args: Parameters<T>) => void) => {
  let canRun = true;
  return function (this: any, ...args: Parameters<T>) {
    if (!canRun) return;
    fn.apply(this, args);
    canRun = false;
    setTimeout(() => {
      canRun = true;
    }, delay);
  };
};
/**
 * 检查值是否为空
 * @param value 要检查的值
 * @returns 如果为空返回 true，否则返回 false
 */
export function isEmpty(value: unknown): boolean {
  if (value == null) return true;

  // 提前返回，避免不必要的类型检查
  const type = typeof value;
  if (type === 'string') return value.trim() === '';
  if (type === 'object') {
    if (Array.isArray(value)) return value.length === 0;
    return Object.keys(value).length === 0;
  }

  return false;
}
/**
 * 类型守卫：检查值是否为字符串
 * @param value 要检查的值
 * @returns 如果是字符串返回 true
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * 类型守卫：检查值是否为 undefined
 * @param value 要检查的值
 * @returns 如果是 undefined 返回 true
 */
export function isUndefined(value: unknown): value is undefined {
  return typeof value === "undefined";
}

/**
 * 创建一个只读的 Proxy 对象，拦截所有修改操作
 * @param rawObject 需要保护的对象
 * @returns 只读的 Proxy 对象
 * @throws {Error} 当尝试修改、删除或定义属性时抛出错误
 */
export const readonly = <T extends object>(rawObject: T): Readonly<T> => {
  return new Proxy(rawObject, {
    set(_target, prop, _value) {
      throw new Error(`Property '${String(prop)}' is read-only`);
    },
    deleteProperty(_target, prop) {
      throw new Error(`Property '${String(prop)}' cannot be deleted`);
    },
    defineProperty(_target, prop, _descriptor) {
      throw new Error(`Property '${String(prop)}' cannot be defined`);
    },
  }) as Readonly<T>;
};
/**
 * 类型守卫：检查值是否为纯对象（非数组、非 null）
 * @param value 要检查的值
 * @returns 如果是纯对象返回 true
 */
export function isObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 获取当前页面的完整 URL
 * @returns 当前页面的 href，如果环境不支持返回空字符串
 */
export function getLocationHref(): string {
  if (typeof document === "undefined" || document.location == null) return "";
  return document.location.href;
}
/**
 * 重写对象上面的某个属性（AOP 面向切面编程）
 * @param source 需要被重写的对象
 * @param name 需要被重写对象的属性名
 * @param replacement 以原有的函数作为参数，执行并重写原有函数
 * @param isForced 是否强制重写（可能原先没有该属性）
 */
export function replaceAop(
  source: any,
  name: string,
  replacement: (original: any) => any,
  isForced = false
): void {
  if (source === undefined) return;
  if (name in source || isForced) {
    const original = source[name];
    const wrapped = replacement(original);
    if (typeof wrapped === "function") {
      source[name] = wrapped;
    }
  }
}
