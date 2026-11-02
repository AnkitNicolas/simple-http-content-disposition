import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContentDisposition, buildContentDisposition } from '../src/index.js';

test('parses a simple attachment with a quoted filename', () => {
  const result = parseContentDisposition('attachment; filename="report.pdf"');
  assert.equal(result.type, 'attachment');
  assert.equal(result.parameters.get('filename'), 'report.pdf');
});

test('parses a token filename without quotes', () => {
  const result = parseContentDisposition('inline; filename=notes.txt');
  assert.equal(result.type, 'inline');
  assert.equal(result.parameters.get('filename'), 'notes.txt');
});

test('parses an RFC 5987 extended filename', () => {
  const header = "attachment; filename*=UTF-8''na%C3%AFve.txt";
  const result = parseContentDisposition(header);
  assert.equal(result.parameters.get('filename'), 'na\u00efve.txt');
});

test('extended parameter wins over the plain fallback', () => {
  const header = "attachment; filename=\"fallback.txt\"; filename*=UTF-8''real.txt";
  const result = parseContentDisposition(header);
  assert.equal(result.parameters.get('filename'), 'real.txt');
});

test('parses ISO-8859-1 extended parameters', () => {
  const header = "attachment; filename*=ISO-8859-1''caf%E9.txt";
  const result = parseContentDisposition(header);
  assert.equal(result.parameters.get('filename'), 'caf\u00e9.txt');
});

test('unknown charsets keep the raw encoded value', () => {
  const header = "attachment; filename*=Shift_JIS''%93%fa.txt";
  const result = parseContentDisposition(header);
  assert.equal(result.parameters.get('filename'), "Shift_JIS''%93%fa.txt");
});

test('handles quoted strings with escaped quotes', () => {
  const header = 'attachment; filename="a\\"b.txt"';
  const result = parseContentDisposition(header);
  assert.equal(result.parameters.get('filename'), 'a"b.txt');
});

test('handles a bare parameter with no value', () => {
  const result = parseContentDisposition('attachment; filename');
  assert.equal(result.parameters.get('filename'), '');
});

test('rejects an empty header', () => {
  assert.throws(() => parseContentDisposition(''), /empty Content-Disposition header/);
});

test('rejects a non-string header', () => {
  assert.throws(() => parseContentDisposition(null), TypeError);
});

test('builds a simple attachment with an ASCII filename', () => {
  const header = buildContentDisposition('attachment', { filename: 'report.pdf' });
  assert.equal(header, 'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf');
});

test('builds an extended filename for non-ASCII values', () => {
  const header = buildContentDisposition('attachment', { filename: 'na\u00efve.txt' });
  assert.equal(header, "attachment; filename*=UTF-8''na%C3%AFve.txt");
});

test('builds a token parameter without quotes', () => {
  const header = buildContentDisposition('inline', { size: '1024' });
  assert.equal(header, 'inline; size=1024');
});

test('round-trips a non-ASCII filename', () => {
  const header = buildContentDisposition('attachment', { filename: 'na\u00efve.txt' });
  const parsed = parseContentDisposition(header);
  assert.equal(parsed.parameters.get('filename'), 'na\u00efve.txt');
});

test('round-trips an ASCII filename through both parameters', () => {
  const header = buildContentDisposition('attachment', { filename: 'report.pdf' });
  const parsed = parseContentDisposition(header);
  assert.equal(parsed.parameters.get('filename'), 'report.pdf');
});

test('rejects an invalid disposition type when building', () => {
  assert.throws(() => buildContentDisposition('', {}), /invalid disposition type/);
});
