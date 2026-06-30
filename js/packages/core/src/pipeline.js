function createNamedError(name, message, details = {}) {
  const error = new Error(message);
  error.name = name;
  Object.assign(error, details);
  return error;
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

  if (typeof value === 'string') {
    return Buffer.from(value, 'utf8');
  }

  throw createNamedError('TemplateSyntaxError', 'Only string and Buffer stream values are supported synchronously');
}

function applyHydrateFunction(value, functionName, streams) {
  switch (functionName) {
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
      throw createNamedError('TemplateSyntaxError', `Unsupported hydrate function: ${functionName}`);
  }
}

function hydrate(template, data, streams = []) {
  let hydratedCursor = 0;
  const map = [];
  const normalizedTemplate = String(template).replace(/\r\n/g, '\n');

  let resolved = normalizedTemplate.replace(/\{\{\s*([^|}]+?)\s*\|\s*([^}]+?)\s*\}\}/g, (match, key, functionName, offset) => {
    const dataKey = key.trim();
    const transform = functionName.trim();

    if (!Object.prototype.hasOwnProperty.call(data, dataKey)) {
      throw createNamedError('MissingArgumentError', `Missing data key: ${dataKey}`, {
        missing: dataKey,
      });
    }

    hydratedCursor += offset - (map.at(-1)?.['original-start'] ?? 0) - (map.at(-1)?.['original-length'] ?? 0);

    const replacement = applyHydrateFunction(data[dataKey], transform, streams);
    map.push({
      'hydrated-start': hydratedCursor,
      'original-start': offset,
      'hydrated-length': replacement.length,
      'original-length': match.length,
    });
    hydratedCursor += replacement.length;

    return replacement;
  });

  const boundaryMatch = resolved.match(/\r?\n\r?\n/);
  const boundaryIndex = boundaryMatch ? boundaryMatch.index : resolved.length;
  const boundary = boundaryMatch ? boundaryMatch[0] : '\n\n';
  let head = resolved.slice(0, boundaryIndex).replace(/\n+$/, '');
  let body = boundaryMatch ? resolved.slice(boundaryIndex + boundary.length) : '';

  if (Array.isArray(data.headers) && data.headers.length > 0) {
    const dynamicHeaders = data.headers
      .map(({ name, value }) => `${name}: ${value}`)
      .join('\n');
    head = `${head}\n${dynamicHeaders}`;
  }

  if (data.body) {
    if (body.trim()) {
      const error = new Error('Template already contains a body');
      error.name = 'BodyConflictError';
      throw error;
    }
    const bodyType = data.body.type || 'text';
    head = `${head}\n:httpt-body-type: ${bodyType}`;
    body = data.body.content == null ? '' : String(data.body.content);
  }

  resolved = `${head}${boundary}${body}`;

  return { resolved, map, bodyStream: null };
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
      throw createNamedError('TemplateSyntaxError', `Invalid header line: ${line}`);
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
      content = JSON.parse(normalizedBody);
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

module.exports = { hydrate, parse };
