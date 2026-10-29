// Validate public-facing links without fetching the company site. Accept older
// bare-domain input, but only store HTTP(S) URLs that staff can safely open.
export function readCompanyWebsite(value) {
  if (value == null || (typeof value === "string" && !value.trim())) {
    return { error: "Company website is required. Enter the company's official website or social media page." };
  }
  if (typeof value !== "string") return { error: "Company website must be a valid website address." };
  const input = value.trim();
  if (input.length > 255 || /\s/.test(input)) return { error: "Enter a valid company website address of at most 255 characters." };
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".") || url.href.length > 255) throw new Error();
    return { website: url.href };
  } catch {
    return { error: "Enter a valid company website, such as https://company.com, or its official social media page." };
  }
}
