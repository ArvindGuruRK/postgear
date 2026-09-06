/**
 * Input sanitization primitives.
 *
 * These run on the server, on every request, regardless of what the browser
 * already checked. Client-side validation is a UX affordance; anyone can POST
 * straight to the API with curl.
 *
 * ## The one field that is never sanitized
 *
 * **Passwords are not sanitized. Ever.** Not trimmed, not HTML-stripped, not
 * "special character" filtered. Three reasons:
 *
 *   1. Stripping characters silently weakens the secret — `p<ssw>rd!` becoming
 *      `pssw rd!` removes entropy the user thought they had.
 *   2. It breaks password managers, which generate exactly the punctuation-
 *      heavy strings a naive filter eats.
 *   3. It is unnecessary. A password is never rendered, never interpolated
 *      into a query, and never stored — only its argon2id digest is. There is
 *      no injection surface to defend.
 *
 * Passwords are *validated* (length, composition) and then hashed verbatim.
 * This is a deliberate, documented exception to the "strip special characters
 * from every auth field" instruction.
 */

/**
 * Removes HTML/XML markup, including unclosed and malformed tags.
 *
 * Deliberately allowlist-free: it strips *all* markup rather than permitting
 * "safe" tags. None of the fields this guards — display name, organization
 * name — has any legitimate reason to contain markup, so there is nothing to
 * preserve, and a permissive sanitizer is where XSS bypasses live.
 *
 * Script and style elements have their *contents* removed too, not just their
 * tags — otherwise `<script>alert(1)</script>` would sanitize to the string
 * `alert(1)`, which is worse than useless as a display name.
 */
export function stripHtml(input: string): string {
  return (
    input
      // Element contents first: script/style bodies are not text.
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      // An unterminated `<script` with no closing bracket at all.
      .replace(/<(script|style)\b[\s\S]*$/gi, '')
      // Any remaining tag, complete or not.
      .replace(/<[^>]*>/g, '')
      // A trailing `<` that never opened a tag.
      .replace(/<[\s\S]*$/g, '')
      // Entities last, so `&lt;script&gt;` cannot be decoded back into a tag
      // by an earlier pass. Decoding is not the goal — removal is.
      .replace(/&[#a-zA-Z0-9]+;?/g, '')
  );
}

/**
 * Strips C0/C1 control characters, plus the zero-width and direction-override
 * characters used for homograph and impersonation tricks.
 *
 * U+200B-U+200F and U+202A-U+202E are the invisible ones: a display name
 * carrying an RTL override renders as something other than what is stored,
 * which is exactly the spoofing vector this closes. U+FEFF is a stray BOM.
 *
 * Tab, newline and carriage return (0x09, 0x0A, 0x0D) are deliberately spared
 * even though they fall inside the C0 range. Deleting them outright would
 * glue words together — `Alice{newline}Smith` becoming `AliceSmith`.
 * collapseWhitespace turns them into single spaces instead, which is what a
 * pasted multi-line name should become.
 */
// Hoisted to its own binding so the suppression comment stays glued to the
// pattern. Inline, the formatter wraps the `.replace(` call and pushes the
// regex onto its own line, which silently detaches the biome-ignore above it \u2014
// suppressions apply to the following line only.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is this function's entire purpose
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200F\u202A-\u202E\uFEFF]/g;

export function stripControlChars(input: string): string {
  return input.replace(CONTROL_CHARS, '');
}

/** Collapses runs of whitespace to a single space and trims the ends. */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Full cleanup for a free-text field that will be displayed back to users:
 * display name, organization name.
 *
 * Order matters. Control characters go first so that a zero-width space
 * cannot hide inside `<scr[U+200B]ipt>` and survive the tag pass.
 */
export function sanitizeText(input: string): string {
  return collapseWhitespace(stripHtml(stripControlChars(input)));
}

/**
 * Normalizes an email for storage and lookup: trims, lowercases, strips
 * control characters.
 *
 * Note what this does *not* do — it does not strip "special characters".
 * `+`, `.`, `'` and `-` are all legal in the local part, and removing them
 * would silently deliver mail to the wrong address (or to nobody). Email is
 * validated against a strict pattern instead; see `dto/common.schema.ts`.
 *
 * Lowercasing the local part is technically a departure from RFC 5321, which
 * says it is case-sensitive. Every mail provider in practice treats it as
 * insensitive, and not normalizing means `Bob@x.com` and `bob@x.com` become
 * two accounts — a far worse outcome than the theoretical incompatibility.
 */
export function normalizeEmail(input: string): string {
  return stripControlChars(input).trim().toLowerCase();
}
