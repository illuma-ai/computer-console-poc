/**
 * Only http(s) links are rendered, so a crafted value (a `javascript:` URL, say) cannot become a link.
 *
 * @param value The URL the service or an agent sent.
 */
export function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
