/**
 * Hydrates an httpt template into three streams, returned SYNCHRONOUSLY and
 * filled by a detached background worker; an error anywhere (bad input, an
 * unknown filter) fails all three outputs, so every consumer sees it.
 *
 * `{{ name | filter }}` tags resolve from `data` (filters: raw, url,
 * json-value, json-string, json-key). The first blank line (`\n\n`) splits
 * head from body. Each resolved tag pushes one map entry
 * `{ hydrated-start, original-start, hydrated-length, original-length }`
 * (offsets into the resolved output / the source template). If the head
 * declares `:httpt-body-type: provided`, the body comes from `streams[0]`
 * and any inline body text is ignored.
 *
 * @param {ReadableStream<Uint8Array | string>} templateStream
 * @param {Object} [data={}]
 * @param {Array<ReadableStream<Uint8Array> | Blob | any>} [streams=[]]
 * @returns {{
 * resolvedStream: AsyncIterable<string>,
 * mapStream: AsyncIterable<object>,
 * bodyStream: ReadableStream<Uint8Array>
 * }}
 */
export function hydrate(templateStream, data = {}, streams = []) {
  const resolved = channel();
  const map = channel();
  let bodyOut;
  const bodyStream = new ReadableStream({ start: (c) => (bodyOut = c) });
  const encoder = new TextEncoder();

  (async () => {
    let head = null;
    let providedBody = false;
    let laterSegment = false;

    for await (const segment of splitOn(substitute(decode(templateStream), data, map), '\n\n')) {
      if (head === null) {
        head = segment;
        providedBody = /(^|\n)[ \t]*:httpt-body-type[ \t]*:[ \t]*provided/i.test(head);
        resolved.push(head);
        resolved.end();
      } else if (!providedBody) {
        // Later segments are body text that contained '\n\n' itself — restore it.
        if (laterSegment) bodyOut.enqueue(encoder.encode('\n\n'));
        bodyOut.enqueue(encoder.encode(segment));
        laterSegment = true;
      }
    }
    map.end();

    if (providedBody && streams[0] != null) {
      const s = streams[0];
      const source = typeof s.stream === 'function' ? s.stream() : s; // Blob / File
      const chunks = typeof source === 'string' || ArrayBuffer.isView(source) ? [source] : source;
      for await (const c of chunks) bodyOut.enqueue(typeof c === 'string' ? encoder.encode(c) : c);
    }
    bodyOut.close();
  })().catch((err) => {
    resolved.fail(err);
    map.fail(err);
    try { bodyOut.error(err); } catch { /* already settled */ }
  });

  return { resolvedStream: resolved, mapStream: map, bodyStream };
}

const FILTERS = {
  raw: (v) => (v == null ? '' : String(v)),
  url: (v) => (v == null ? '' : encodeURIComponent(String(v))),
  'json-value': (v) => JSON.stringify(v, null, 1).replace(/\n */g, ' '),
  'json-string': (v) => JSON.stringify(String(v)).slice(1, -1),
  'json-key': (v) => JSON.stringify(String(v)).slice(1, -1),
};

/** Substitutes tags in a chunk stream, chunk-safe (a tag split across chunks
 * is held back until its `}}` arrives), pushing one map entry per tag. */
async function* substitute(chunks, data, map) {
  let buf = '';
  let src = 0; // offset in the source template
  let out = 0; // offset in the substituted output
  for await (const chunk of chunks) {
    buf += chunk;
    for (;;) {
      const open = buf.indexOf('{{');
      const safeEnd = open === -1 ? buf.length - (buf.endsWith('{') ? 1 : 0) : open;
      if (safeEnd > 0) {
        const literal = buf.slice(0, safeEnd);
        src += literal.length;
        out += literal.length;
        buf = buf.slice(safeEnd);
        yield literal;
      }
      if (open === -1) break;
      const close = buf.indexOf('}}', 2);
      if (close === -1) break; // hold the partial tag for the next chunk
      const [name, ...filters] = buf.slice(2, close).split('|').map((t) => t.trim());
      let value = data[name];
      for (const f of filters) {
        if (!FILTERS[f]) { const e = new Error(`Unknown template filter: '${f}'`); e.name = 'TemplateSyntaxError'; throw e; }
        value = FILTERS[f](value);
      }
      const text = filters.length ? String(value ?? '') : FILTERS.raw(value);
      map.push({ 'hydrated-start': out, 'original-start': src, 'hydrated-length': text.length, 'original-length': close + 2 });
      src += close + 2;
      out += text.length;
      buf = buf.slice(close + 2);
      if (text) yield text;
    }
  }
  if (buf) yield buf; // trailing literal (or unterminated tag), verbatim
}

/** Splits a chunk stream on a delimiter; correct across chunk boundaries. */
async function* splitOn(chunks, delimiter) {
  let buf = '';
  for await (const chunk of chunks) {
    buf += chunk;
    let at;
    while ((at = buf.indexOf(delimiter)) !== -1) {
      yield buf.slice(0, at);
      buf = buf.slice(at + delimiter.length);
    }
  }
  yield buf;
}

/** Normalizes string / bytes / ReadableStream / (async) iterable into decoded
 * text chunks; multi-byte UTF-8 split across chunks decodes intact. */
async function* decode(input) {
  if (input == null) return;
  if (typeof input === 'string') { yield input; return; }
  const decoder = new TextDecoder();
  if (ArrayBuffer.isView(input)) { yield decoder.decode(input); return; }
  const iterable =
    typeof input[Symbol.asyncIterator] === 'function' || typeof input[Symbol.iterator] === 'function'
      ? input
      : readerChunks(input); // ReadableStream without async iteration
  for await (const chunk of iterable) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (text) yield text;
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

async function* readerChunks(stream) {
  const reader = stream.getReader();
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { finished = true; return; }
      yield value;
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {}); // early exit: release the source
    reader.releaseLock();
  }
}

/** One-producer/one-consumer channel: push()/end()/fail() -> `for await`. */
function channel() {
  const buffer = [];
  let closed = false;
  let failed = false; // distinct from `error`: fail(undefined) must still throw
  let error;
  let wake = () => {};
  return {
    push(v) { if (!closed) { buffer.push(v); wake(); } },
    end()   { closed = true; wake(); },
    fail(e) { if (!closed) { failed = true; error = e; closed = true; wake(); } },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (buffer.length) yield buffer.shift();
        if (closed) { if (failed) throw error; return; }
        await new Promise((resolve) => (wake = resolve));
      }
    },
  };
}
