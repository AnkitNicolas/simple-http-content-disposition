# simple-http-content-disposition

Parses and builds HTTP `Content-Disposition` headers, including the RFC 5987
`filename*` extended parameter used for non-ASCII filenames.

```js
import { parseContentDisposition, buildContentDisposition } from 'simple-http-content-disposition';

const parsed = parseContentDisposition("attachment; filename*=UTF-8''na%C3%AFve.txt");
parsed.type;                          // 'attachment'
parsed.parameters.get('filename');    // 'naïve.txt'

const header = buildContentDisposition('attachment', { filename: 'naïve.txt' });
// "attachment; filename*=UTF-8''na%C3%AFve.txt"
```

`parseContentDisposition` returns `{ type, parameters }` where `parameters` is a
`Map`. `buildContentDisposition` takes a disposition type and a plain object of
parameters and returns the header string.

## Why this exists

The `Content-Disposition` header has two ways to carry a filename: the old
`filename="..."` parameter, which is not defined for non-ASCII bytes, and the
RFC 5987 `filename*=UTF-8''...` parameter, which is. Real servers send both,
sometimes in either order, and clients have to pick. This library picks for
you: when both are present, `filename*` wins, which is what RFC 6266 says and
what browsers do.

The trade-off is charset handling. Extended values are decoded for `UTF-8` and
`ISO-8859-1`, because those are the two charsets the standard library can
decode without a lookup table. A `filename*` in any other charset is returned
as its raw encoded value rather than guessed at. A wrong guess is worse than a
raw value, and adding a charset table would mean either a dependency or a large
hand-maintained table in a small library.

## The awkward edge

Quoted strings are not always escaped the way the grammar says. Some servers
write `filename="a\"b.txt"` to mean a literal backslash, others write it to
mean a literal quote. This library treats a backslash as escaping the next
character, so `\"` becomes `"` and `\\` becomes `\`. If you receive a header
where the backslash was meant literally, the parsed filename will be one
character shorter than the sender intended. There is no way to tell the two
apart from the header alone.
