function createNamedError(name, message, details = {}) {
  const error = new Error(message);
  error.name = name;
  Object.assign(error, details);
  return error;
}

const BUILT_IN_FUNCTIONS = new Set([
  'raw',
  'url',
  'json-value',
  'json-string',
  'json-key',
  'stream-as-base64',
  'stream-as-utf8',
  'stream-as-is',
]);

function isPlainObject(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function isNativeStream(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (
      Buffer.isBuffer(value) ||
      value instanceof Uint8Array ||
      typeof value.pipe === 'function' ||
      typeof value.getReader === 'function' ||
      typeof value.arrayBuffer === 'function'
    )
  );
}

function cloneDataWithExtractedStreams(value, streams) {
  if (isNativeStream(value)) {
    const content = streams.length;
    streams.push(value);
    return { type: 'provided', content };
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneDataWithExtractedStreams(item, streams));
  }

  if (isPlainObject(value)) {
    const cloned = {};
    for (const [key, childValue] of Object.entries(value)) {
      cloned[key] = cloneDataWithExtractedStreams(childValue, streams);
    }
    return cloned;
  }

  return value;
}

function prepareHydrationContext(data, streams = []) {
  const preparedStreams = Array.isArray(streams) ? streams.slice() : [];
  const preparedData = cloneDataWithExtractedStreams(data || {}, preparedStreams);

  validateStreamReferences(preparedData);

  return { data: preparedData, streams: preparedStreams };
}

function collectProvidedReferences(value, references = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectProvidedReferences(item, references);
    return references;
  }

  if (!isPlainObject(value)) {
    return references;
  }

  if (value.type === 'provided') {
    references.push({
      explicit: Object.prototype.hasOwnProperty.call(value, 'content'),
      index: value.content == null ? 0 : value.content,
    });
  }

  for (const childValue of Object.values(value)) {
    collectProvidedReferences(childValue, references);
  }

  return references;
}

function validateStreamReferences(data) {
  const references = collectProvidedReferences(data);

  if (references.length > 1 && references.some((reference) => !reference.explicit)) {
    throw createNamedError(
      'TemplateSyntaxError',
      'Ambiguous provided stream reference: content index is required when multiple streams are referenced'
    );
  }

  const seen = new Set();
  for (const reference of references) {
    if (!Number.isInteger(reference.index) || reference.index < 0) {
      throw createNamedError('TemplateSyntaxError', `Invalid provided stream index: ${reference.index}`);
    }

    if (seen.has(reference.index)) {
      throw createNamedError('TemplateSyntaxError', `Duplicate provided stream index: ${reference.index}`);
    }
    seen.add(reference.index);
  }

  return true;
}

async function resolveToString(input) {
  if (typeof input === 'string') {
    return input;
  }

  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    return Buffer.from(input).toString('utf8');
  }

  if (input && typeof input.getReader === 'function') {
    const reader = input.getReader();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  if (input && typeof input[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  return String(input);
}

function formatJsonValue(value) {
  const json = JSON.stringify(value);

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return json.replace(/^\{/, '{ ').replace(/\}$/, ' }').replace(/:/g, ': ').replace(/,/g, ', ');
  }

  return json;
}

function resolveStreamValue(value, streams) {
  if (value && typeof value === 'object' && value.type === 'provided') {
    const streamIndex = value.content == null ? 0 : value.content;
    const stream = streams[streamIndex];

    if (stream == null) {
      throw createNamedError('MissingArgumentError', `Missing provided stream at index ${streamIndex}`, {
        missing: streamIndex,
      });
    }

    return stream;
  }

  return value;
}

function materializeStream(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (typeof value === 'string') {
    return Buffer.from(value, 'utf8');
  }

  throw createNamedError('TemplateSyntaxError', 'Only string and Buffer stream values are supported synchronously');
}

function parseHydrateFunction(functionSource) {
  const trimmed = functionSource.trim();
  const match = trimmed.match(/^([A-Za-z0-9-]+)(?:\((.*)\))?$/);

  if (!match) {
    throw createNamedError('TemplateSyntaxError', `Invalid hydrate function: ${trimmed}`);
  }

  const name = match[1];
  const args = match[2] == null || !match[2].trim()
    ? []
    : match[2].split(',').map((arg) => arg.trim()).filter(Boolean);

  if (!BUILT_IN_FUNCTIONS.has(name)) {
    throw createNamedError('TemplateSyntaxError', `Unsupported hydrate function: ${name}`);
  }

  return { name, args };
}

function applyHydrateFunction(value, hydrateFunction, streams) {
  switch (hydrateFunction.name) {
    case 'raw':
      return String(value);
    case 'url':
      return encodeURIComponent(String(value));
    case 'json-value':
      return formatJsonValue(value);
    case 'json-string':
      return JSON.stringify(String(value)).slice(1, -1);
    case 'json-key':
      return JSON.stringify(String(value)).slice(1, -1);
    case 'stream-as-base64':
      return materializeStream(resolveStreamValue(value, streams)).toString('base64');
    case 'stream-as-utf8':
      return materializeStream(resolveStreamValue(value, streams)).toString('utf8');
    case 'stream-as-is':
      return materializeStream(resolveStreamValue(value, streams)).toString('utf8');
    default:
      throw createNamedError('TemplateSyntaxError', `Unsupported hydrate function: ${hydrateFunction.name}`);
  }
}

function hydrate(template, data, streams = []) {
  const prepared = prepareHydrationContext(data, streams);
  data = prepared.data;
  streams = prepared.streams;

  const map = [];
  const source = String(template);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let shift = 0;

  let resolved = source.replace(/\{\{\s*([^|}]+?)\s*((?:\|\s*[^|}]+?\s*)+)\}\}/g, (match, key, functionSource, offset) => {
    const dataKey = key.trim();
    const transforms = functionSource
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .map(parseHydrateFunction);

    if (!Object.prototype.hasOwnProperty.call(data, dataKey)) {
      throw createNamedError('MissingArgumentError', `Missing data key: ${dataKey}`, {
        missing: dataKey,
      });
    }

    let replacement = data[dataKey];
    for (const transform of transforms) {
      replacement = applyHydrateFunction(replacement, transform, streams);
    }
    replacement = String(replacement);

    map.push({
      'hydrated-start': offset + shift,
      'original-start': offset,
      'hydrated-length': replacement.length,
      'original-length': match.length,
    });
    shift += replacement.length - match.length;

    return replacement;
  });

  const boundaryMatch = resolved.match(/\r?\n\r?\n/);
  const boundaryIndex = boundaryMatch ? boundaryMatch.index : resolved.length;
  let boundary = boundaryMatch ? boundaryMatch[0] : '';
  let head = resolved.slice(0, boundaryIndex).replace(/(?:\r?\n)+$/, '');
  let body = boundaryMatch ? resolved.slice(boundaryIndex + boundary.length) : '';
  let bodyStream = null;

  if (Array.isArray(data.headers) && data.headers.length > 0) {
    const dynamicHeaders = data.headers
      .map(({ name, value }) => `${name}: ${value}`)
      .join(newline);
    head = `${head}${newline}${dynamicHeaders}`;
  }

  if (data.body) {
    if (body.trim()) {
      const error = new Error('Template already contains a body');
      error.name = 'BodyConflictError';
      throw error;
    }
    const bodyType = data.body.type || 'text';
    head = `${head}${newline}:httpt-body-type: ${bodyType}`;

    if (bodyType === 'provided') {
      const streamIndex = data.body.content == null ? 0 : data.body.content;
      bodyStream = streams[streamIndex] || null;
      body = '';
    } else {
      body = data.body.content == null ? '' : String(data.body.content);
      if (body && !boundary) {
        boundary = `${newline}${newline}`;
      }
    }
  }

  resolved = `${head}${boundary || newline}${body}`;

  return { resolved, map, bodyStream };
}

async function hydrateAsync(template, data, streams = []) {
  return hydrate(await resolveToString(template), data, streams);
}

function parse(resolved, optionalBodyStream = null) {
  const normalizedResolved = String(resolved).replace(/\r\n/g, '\n');
  const boundaryMatch = normalizedResolved.match(/\n\n/);
  const boundaryIndex = boundaryMatch ? boundaryMatch.index : normalizedResolved.length;
  const head = normalizedResolved.slice(0, boundaryIndex);
  const body = normalizedResolved.slice(boundaryIndex + (boundaryMatch ? boundaryMatch[0].length : 0));

  const lines = head.split(/\n/).filter(Boolean);
  const requestLine = lines.shift();
  if (!requestLine) {
    throw createNamedError('TemplateSyntaxError', 'Invalid request: missing request line');
  }

  const [method, uri, version] = requestLine.trim().split(/\s+/);
  if (!method || !uri || !version) {
    throw createNamedError('TemplateSyntaxError', `Invalid request line: ${requestLine}`);
  }

  const headers = [];
  let host = '';
  let bodyType = 'text';

  for (const line of lines) {
    const colonIndex = line.startsWith(':') ? line.indexOf(':', 1) : line.indexOf(':');
    if (colonIndex === -1) {
      const index = normalizedResolved.indexOf(line);
      throw createNamedError('TemplateSyntaxError', `Invalid header line: ${line}`, { index });
    }
    const name = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    if (name.toLowerCase() === 'host') {
      host = value;
    } else if (name.toLowerCase() === ':httpt-body-type') {
      bodyType = value || 'text';
    } else {
      headers.push({ name, value });
    }
  }

  const ir = {
    'schema-version': '1.0',
    method,
    host,
    uri,
    version,
    headers,
  };

  const normalizedBody = body.replace(/\n+$/, '');

  if (bodyType === 'provided') {
    ir.body = {
      type: 'provided',
      content: 0,
    };
  } else if (normalizedBody) {
    let content = normalizedBody;
    if (bodyType === 'json') {
      try {
        content = JSON.parse(normalizedBody);
      } catch (error) {
        throw createNamedError('TemplateSyntaxError', `Invalid JSON body: ${error.message}`, {
          index: normalizedResolved.indexOf(normalizedBody),
        });
      }
    } else if (bodyType === 'base64') {
      content = normalizedBody.trim();
    }
    ir.body = {
      type: bodyType,
      content,
    };
  }

  return { ir, bodyStream: optionalBodyStream };
}

async function parseAsync(resolved, optionalBodyStream = null) {
  return parse(await resolveToString(resolved), optionalBodyStream);
}

function scanTemplate(template) {
  const source = String(template);
  const tags = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf('{{', cursor);
    if (start === -1) break;

    const end = source.indexOf('}}', start + 2);
    if (end === -1) {
      throw createNamedError('TemplateSyntaxError', 'Unclosed template tag', { index: start });
    }

    const inner = source.slice(start + 2, end);
    if (inner.includes('{{')) {
      throw createNamedError('TemplateSyntaxError', 'Nested template tags are not allowed', { index: start });
    }

    const parts = inner.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) {
      throw createNamedError('TemplateSyntaxError', 'Template tag must include at least one function', { index: start });
    }

    const parameter = parts[0];
    const functions = parts.slice(1).map((part) => parseHydrateFunction(part));
    tags.push({ parameter, functions, start, end: end + 2 });
    cursor = end + 2;
  }

  const strayClose = source.indexOf('}}', cursor);
  if (strayClose !== -1) {
    throw createNamedError('TemplateSyntaxError', 'Unexpected template close tag', { index: strayClose });
  }

  return tags;
}

function verifyContract(template, expectedArguments = []) {
  const tags = scanTemplate(template);
  const used = new Set(tags.map((tag) => tag.parameter));
  const expected = new Set(expectedArguments);

  const missing = [...used].filter((key) => !expected.has(key));
  if (missing.length > 0) {
    throw createNamedError('MissingArgumentError', `Template requires missing contract arguments: ${missing.join(', ')}`, {
      missing,
    });
  }

  const extra = [...expected].filter((key) => !used.has(key));
  if (extra.length > 0) {
    throw createNamedError('UnexpectedArgumentError', `Contract includes unused arguments: ${extra.join(', ')}`, {
      extra,
    });
  }

  return true;
}

module.exports = {
  hydrate,
  hydrateAsync,
  parse,
  parseAsync,
  verifyContract,
  validateStreamReferences,
  prepareHydrationContext,
  resolveToString,
};
