export function htmlElementAsString(target: HTMLElement): string {
  const tagName = target.tagName.toLowerCase();
  if (tagName === "body") {
    return "";
  }
  let classNames = target.classList.value;

  classNames = classNames !== "" ? ` class='${classNames}'` : "";
  const id = target.id ? ` id="${target.id}"` : "";
  const innerText = target.innerText;
  return `<${tagName}${id}${
    classNames !== "" ? classNames : ""
  }>${innerText}</${tagName}>`;
}
export function parseUrlToObj(url: string) {
  if (!url) {
    return {};
  }
  const match = url.match(
    /^(([^:\/?#]+):)?(\/\/([^\/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?$/
  );
  if (!match) {
    return {};
  }
  const query = match[6] || "";
  const fragment = match[8] || "";
  return {
    host: match[4],
    path: match[5],
    protocol: match[2],
    relative: match[5] + query + fragment,
  };
}
