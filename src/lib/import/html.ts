/**
 * Tiny HTML helpers. No DOM parser: the import only needs to pull JSON-LD
 * blocks out of a page, turn HTML into readable text, and clean up strings
 * that site generators leave full of entities and tags.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  frac13: "⅓",
  frac23: "⅔",
  frac18: "⅛",
  deg: "°",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  times: "×",
  eacute: "é",
  egrave: "è",
  ntilde: "ñ",
  ccedil: "ç",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Strip tags and entities from a snippet of HTML, collapsing whitespace. */
export function cleanText(s: string): string {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** The raw text of every `<script type="application/ld+json">` block. */
export function findJsonLdBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const body = m[1].trim();
    if (body) out.push(body);
  }
  return out;
}

export function pageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? cleanText(m[1]) || null : null;
}

/**
 * Readable text for the Claude fallback: drop scripts, styles and page
 * chrome, keep block structure as line breaks, collapse whitespace.
 */
export function htmlToText(html: string, maxChars = 40_000): string {
  let s = html;
  // Drop whole elements that never contain the recipe.
  for (const tag of ["script", "style", "noscript", "svg", "template", "iframe", "nav", "header", "footer", "aside", "form", "button", "select"]) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Prefer <main> or <article> when the page has one.
  const main = s.match(/<main\b[\s\S]*?<\/main>/i) ?? s.match(/<article\b[\s\S]*?<\/article>/i);
  if (main && cleanText(main[0]).length > 500) s = main[0];
  const text = cleanText(s)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
