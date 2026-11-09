import { isIP } from "node:net";
import dns from "node:dns/promises";

/**
 * Fetch a recipe page on the server with the guards a URL-fetching endpoint
 * needs: http(s) only, no private or local addresses (also after redirects),
 * a short timeout, and a cap on how much we read.
 */

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 MealsRecipeImporter/1.0";

export class ImportUrlError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 502 | 504 = 400,
  ) {
    super(message);
    this.name = "ImportUrlError";
  }
}

/**
 * Set IMPORT_ALLOW_PRIVATE_URLS=true to let the importer reach localhost and
 * private networks. Only for local testing against a fixture server; never
 * set it on a deployment.
 */
function privateAllowed(): boolean {
  return process.env.IMPORT_ALLOW_PRIVATE_URLS === "true";
}

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24 and 192.0.2.0/24 (TEST-NET-1)
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224 // multicast and reserved
  );
}

/**
 * Expand any IPv6 text form ("::1", "::ffff:7f00:1", "::ffff:127.0.0.1",
 * "0:0:0:0:0:ffff:a00:1") to its 16 bytes, so ranges are tested by value
 * rather than by spelling. Returns null for anything malformed.
 */
export function ipv6ToBytes(ip: string): Uint8Array | null {
  let s = ip.toLowerCase().split("%")[0];
  // A trailing dotted IPv4 part becomes two hex groups.
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[2].split(".").map(Number);
    if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = `${dotted[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
    const v = parseInt(groups[i], 16);
    bytes[i * 2] = v >> 8;
    bytes[i * 2 + 1] = v & 0xff;
  }
  return bytes;
}

function isPrivateIPv6(ip: string): boolean {
  const b = ipv6ToBytes(ip);
  if (!b) return true;
  const zeroUntil = (n: number) => b.subarray(0, n).every((x) => x === 0);
  const low4 = () => `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
  // :: (unspecified) and ::1 (loopback).
  if (zeroUntil(15) && b[15] <= 1) return true;
  // ::ffff:0:0/96 IPv4-mapped: judge the embedded IPv4 address.
  if (zeroUntil(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4(low4());
  // ::/96 deprecated IPv4-compatible form.
  if (zeroUntil(12)) return isPrivateIPv4(low4());
  // 64:ff9b::/96 NAT64: judge the embedded IPv4 address.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.subarray(4, 12).every((x) => x === 0)) {
    return isPrivateIPv4(low4());
  }
  // 64:ff9b:1::/48 local-use NAT64 could map anywhere.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true;
  // 2002::/16 6to4: the next four bytes are an IPv4 address.
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4(`${b[2]}.${b[3]}.${b[4]}.${b[5]}`);
  return (
    (b[0] & 0xfe) === 0xfc || // fc00::/7 unique local
    (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) || // fe80::/10 link-local
    (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) || // fec0::/10 deprecated site-local
    b[0] === 0xff || // multicast
    (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) || // 2001:db8::/32 documentation
    (b[0] === 0x01 && b[1] === 0x00 && b.subarray(2, 8).every((x) => x === 0)) // 100::/64 discard
  );
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true;
}

function isLocalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".home.arpa") ||
    !h.includes(".") // bare machine names resolve via the local network
  );
}

/**
 * Parse and vet a URL the user pasted. Throws ImportUrlError with a message
 * fit to show in the form. Returns the normalized URL.
 */
export function validateImportUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportUrlError("That doesn't look like a web address. Paste the full link, starting with https://");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportUrlError("Only http:// and https:// links can be imported.");
  }
  if (url.username || url.password) {
    throw new ImportUrlError("Links with a username or password in them can't be imported.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!privateAllowed()) {
    // IP literals have no dot rule to apply: the address check below decides.
    if (!isIP(host) && isLocalHostname(host)) {
      throw new ImportUrlError("That address points at a local or private network, which the importer won't fetch.");
    }
    if (isIP(host) && isPrivateAddress(host)) {
      throw new ImportUrlError("That address points at a local or private network, which the importer won't fetch.");
    }
  }
  url.hash = "";
  return url;
}

/** Resolve the hostname and refuse if any answer is a private address. */
async function assertPublicHost(url: URL): Promise<void> {
  if (privateAllowed()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return; // literal IPs were checked in validateImportUrl
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ImportUrlError(`Couldn't find the site "${host}". Check the link.`, 502);
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ImportUrlError("That address points at a local or private network, which the importer won't fetch.");
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const lengthHeader = Number(res.headers.get("content-length"));
  if (Number.isFinite(lengthHeader) && lengthHeader > maxBytes * 4) {
    throw new ImportUrlError("That page is far too large to be a recipe page.", 502);
  }
  if (!res.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes, truncated };
}

export type FetchedPage = {
  html: string;
  /** Where we ended up after redirects. */
  finalUrl: string;
  truncated: boolean;
};

export async function fetchRecipePage(rawUrl: string): Promise<FetchedPage> {
  let url = validateImportUrl(rawUrl);
  const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  for (let hop = 0; ; hop++) {
    await assertPublicHost(url);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: deadline,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
    } catch (err) {
      if (deadline.aborted) {
        throw new ImportUrlError("The site took too long to respond (10 seconds). Try again or type the recipe in.", 504);
      }
      const reason = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
      throw new ImportUrlError(`Couldn't reach ${url.hostname}${reason ? ` (${reason})` : ""}.`, 502);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!location || hop >= MAX_REDIRECTS) {
        throw new ImportUrlError("The link redirected too many times.", 502);
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new ImportUrlError("The site sent a redirect we couldn't follow.", 502);
      }
      url = validateImportUrl(next.toString());
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      const hint =
        res.status === 403 || res.status === 429
          ? " The site is blocking automated requests; try the photo option or type it in."
          : res.status === 404
            ? " Check the link."
            : "";
      throw new ImportUrlError(`${url.hostname} answered with HTTP ${res.status}.${hint}`, 502);
    }

    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !/text\/html|application\/xhtml\+xml|text\/plain/.test(type)) {
      await res.body?.cancel().catch(() => undefined);
      throw new ImportUrlError("That link isn't a web page (it's " + type.split(";")[0] + ").", 400);
    }

    let read: { bytes: Uint8Array; truncated: boolean };
    try {
      read = await readCapped(res, MAX_HTML_BYTES);
    } catch (err) {
      if (err instanceof ImportUrlError) throw err;
      if (deadline.aborted) {
        throw new ImportUrlError("The site took too long to respond (10 seconds). Try again or type the recipe in.", 504);
      }
      throw new ImportUrlError(`Lost the connection to ${url.hostname} while reading the page.`, 502);
    }
    const charset = type.match(/charset=([^;]+)/)?.[1]?.trim().replace(/^"|"$/g, "");
    let html: string;
    try {
      html = new TextDecoder(charset || "utf-8", { fatal: false }).decode(read.bytes);
    } catch {
      html = new TextDecoder("utf-8").decode(read.bytes);
    }
    return { html, finalUrl: url.toString(), truncated: read.truncated };
  }
}
