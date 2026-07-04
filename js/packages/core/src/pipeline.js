async function hydrate(template, data, streams = []) {
  const source = String(template);
  const output = [];
  const map = [];

  let readCursor = 0;
  let writeCursor = 0;

  function templateError(message, index) {
    const error = new Error(message);
    error.name = 'TemplateSyntaxError';
    error.index = index;
    return error;
  }

  function missingKeyError(key) {
    const error = new Error(`Missing data key: ${key}`);
    error.name = 'MissingArgumentError';
    error.missing = key;
    return error;
  }

  function applyFunction(value, name, tagStart) {
    if (name === 'raw') {
      return String(value);
    }

    if (name === 'url') {
      return encodeURIComponent(String(value));
    }

    throw templateError(`Unsupported hydrate function: ${name}`, tagStart);
  }

  function resolveTag(tagSource, tagStart) {
    const parts = tagSource.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) {
      throw templateError('Template tag must include at least one function', tagStart);
    }

    const key = parts[0];
    if (!Object.prototype.hasOwnProperty.call(data || {}, key)) {
      throw missingKeyError(key);
    }

    let value = data[key];
    for (const name of parts.slice(1)) {
      value = applyFunction(value, name, tagStart);
    }

    return String(value);
  }

  function write(value) {
    output.push(value);
    writeCursor += value.length;
  }

  while (readCursor < source.length) {
    if (source[readCursor] !== '{' || source[readCursor + 1] !== '{') {
      write(source[readCursor]);
      readCursor += 1;
      continue;
    }

    const tagStart = readCursor;
    readCursor += 2;

    let tagSource = '';
    while (readCursor < source.length) {
      if (source[readCursor] === '{' && source[readCursor + 1] === '{') {
        throw templateError('Nested template tags are not allowed', readCursor);
      }

      if (source[readCursor] === '}' && source[readCursor + 1] === '}') {
        break;
      }

      tagSource += source[readCursor];
      readCursor += 1;
    }

    if (readCursor >= source.length) {
      throw templateError('Unclosed template tag', tagStart);
    }

    const originalLength = readCursor + 2 - tagStart;
    const replacement = resolveTag(tagSource, tagStart);

    map.push({
      'hydrated-start': writeCursor,
      'original-start': tagStart,
      'hydrated-length': replacement.length,
      'original-length': originalLength,
    });

    write(replacement);
    readCursor += 2;
  }

  return { resolved: output.join(''), map, bodyStream: null };
}

function parse(resolved, optionalBodyStream = null) {
  return { ir: {}, bodyStream: null };
}

module.exports = { hydrate, parse };
