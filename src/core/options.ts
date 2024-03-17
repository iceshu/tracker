interface IOptionsParams {
  dns: string;
  version?: string;
  filterXhrUrlRegExp?: RegExp;
  [key: string]: any;
  beforeDataReport: (T: any) => any;
}
