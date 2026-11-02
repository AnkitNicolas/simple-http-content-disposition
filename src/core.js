// RFC 6266 Content-Disposition parser/builder with RFC 5987 extended parameters.
//
// Design decisions, stated plainly because the spec allows several readings:
//
// * We treat the `filename` parameter as a string. When both `filename` and
//   `filename*` are present, `filename*` wins, per RFC 6266 section 4.3.
// * Extended parameters (`name*=`) are decoded when the charset is `UTF-8` or
//   `ISO-8859-1`. Other charsets are left as the raw percent-encoded value,
//   because decoding them correctly would require a charset table and the
//   standard library has no such table. This is the one trade-off we make.
// * Quoted strings use backslash escaping for `"` and `\\`, as commonly seen
//   in the wild even though RFC 7230 prefers not to escape `\\`.
// * `buildContentDisposition` always emits `filename*` as UTF-8 and also emits
//   a plain `filename` fallback when the value is ASCII-safe. This is what
//   every browser and HTTP client expects in practice.

const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Percent-encode a string for an RFC 5987 ext-value. The allowed set is
 * attr-char: ALPHA / DIGIT / "!#$&+-.^_`|~" (RFC 5987 section 3.2.1).
 * Everything else becomes a %XX byte sequence of the UTF-8 encoding.
 */
function encodeExtValue(value) {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9!#$&+\-.^_`|~]/.test(ch)) {
      out += ch;
    } else {
      out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

/**
 * Decode an RFC 5987 ext-value. Returns the decoded string for UTF-8 and
 * ISO-8859-1, and the raw value otherwise. We never throw on bad input:
 * malformed percent escapes are kept literally, matching how browsers behave.
 */
function decodeExtValue(value) {
  const firstQuote = value.indexOf("'");
  if (firstQuote === -1) return value;
  const secondQuote = value.indexOf("'", firstQuote + 1);
  if (secondQuote === -1) return value;
  const charset = value.slice(0, firstQuote).toLowerCase();
  const encoded = value.slice(secondQuote + 1);
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    const c = encoded[i];
    if (c === '%' && i + 2 < encoded.length) {
      const hex = encoded.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(c.charCodeAt(0) & 0xff);
  }
  if (charset === 'utf-8' || charset === 'utf8') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    } catch {
      // Fall through to latin-1 interpretation rather than failing the parse.
    }
  }
  if (charset === 'iso-8859-1' || charset === 'latin1') {
    return String.fromCharCode(...bytes);
  }
  // Unknown charset: return the raw encoded value so callers can decide.
  return value;
}

/**
 * Parse a Content-Disposition header value into a type and a parameter map.
 *
 * Accepts a single header value. If the input contains a comma (which would
 * mean multiple dispositions), only the first is parsed; the standard says
 * a Content-Disposition header should not be a list, so this is the safest
 * interpretation and avoids surprising callers.
 */
export function parseContentDisposition(header) {
  if (typeof header !== 'string') {
    throw new TypeError('header must be a string');
  }
  const text = header.trim();
  if (text === '') {
    throw new Error('empty Content-Disposition header');
  }

  // Split off the disposition type. A token is anything up to the first
  // semicolon or comma, but we keep it simple: type is the first token.
  let i = 0;
  while (i < text.length && text[i] !== ';' && text[i] !== ',') i++;
  const type = text.slice(0, i).trim().toLowerCase();
  if (type === '' || !TOKEN_RE.test(type)) {
    throw new Error(`invalid disposition type: ${JSON.stringify(type)}`);
  }

  const params = new Map();
  i++; // skip the separator
  while (i < text.length) {
    // Skip whitespace and stray separators.
    while (i < text.length && /[\s;,]/.test(text[i])) i++;
    if (i >= text.length) break;

    // Parameter name.
    const nameStart = i;
    while (i < text.length && text[i] !== '=' && text[i] !== ';' && text[i] !== ',') i++;
    const name = text.slice(nameStart, i).trim().toLowerCase();
    if (name === '') break;

    if (i >= text.length || text[i] !== '=') {
      // A bare parameter with no value: record it as an empty string.
      params.set(name, '');
      continue;
    }
    i++; // skip '='

    let value;
    if (i < text.length && text[i] === '"') {
      // Quoted string. Backslash escapes the next character.
      i++;
      let out = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          out += text[i + 1];
          i += 2;
        } else {
          out += text[i];
          i++;
        }
      }
      if (i < text.length) i++; // closing quote
      value = out;
    } else {
      const valueStart = i;
      while (i < text.length && text[i] !== ';' && text[i] !== ',') i++;
      value = text.slice(valueStart, i).trim();
    }

    if (name.endsWith('*')) {
      const base = name.slice(0, -1);
      const decoded = decodeExtValue(value);
      // Extended parameter overrides any earlier plain parameter of the same
      // base name, matching RFC 6266 section 4.3.
      params.set(base, decoded);
    } else if (!params.has(name)) {
      params.set(name, value);
    }
  }

  return { type, parameters: params };
}

/**
 * Build a Content-Disposition header value from a disposition type and an
 * object of parameters. Parameter names are emitted in insertion order.
 *
 * For `filename`, we emit both a plain `filename` (only when it is safe ASCII)
 * and a `filename*` UTF-8 extended parameter. If the value is not safe ASCII
 * we emit only `filename*`. This matches the behaviour of every major browser
 * and avoids the mojibake that a bare non-ASCII `filename` causes.
 */
export function buildContentDisposition(type, parameters = {}) {
  if (typeof type !== 'string' || type === '' || !TOKEN_RE.test(type)) {
    throw new Error(`invalid disposition type: ${JSON.stringify(type)}`);
  }
  if (parameters === null || typeof parameters !== 'object') {
    throw new TypeError('parameters must be an object');
  }

  const parts = [type];
  for (const [rawName, rawValue] of Object.entries(parameters)) {
    if (rawValue === undefined || rawValue === null) continue;
    const name = String(rawName).toLowerCase();
    if (!TOKEN_RE.test(name)) {
      throw new Error(`invalid parameter name: ${JSON.stringify(rawName)}`);
    }
    const value = String(rawValue);

    if (name === 'filename') {
      // Emit the ASCII fallback first, then the extended parameter. If the
      // value contains non-ASCII characters the fallback is omitted.
      if (isAsciiSafe(value)) {
        parts.push(`filename="${escapeQuoted(value)}"`);
      }
      parts.push(`filename*=UTF-8''${encodeExtValue(value)}`);
      continue;
    }

    if (TOKEN_RE.test(value)) {
      parts.push(`${name}=${value}`);
    } else {
      parts.push(`${name}="${escapeQuoted(value)}"`);
    }
  }

  return parts.join('; ');
}

/**
 * A value is safe to emit as a plain quoted filename when every character is
 * printable ASCII. This is deliberately stricter than the RFC token set so
 * that the fallback filename is unambiguous for old clients.
 */
function isAsciiSafe(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function escapeQuoted(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
