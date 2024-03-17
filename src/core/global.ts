export const _global = window;
export class Global {
  _global: any;
  deviceInfo: any;
  errorMap: WeakMap<any, any> = new WeakMap();
  version?: string;
  constructor() {
    this.setup();
  }
  setup() {}
}
export const global = new Global();
