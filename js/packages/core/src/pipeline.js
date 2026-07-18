function hydrate(template, data = {}, streams = []) {
  let resolvedController;
  let mapController;
  let bodyController;

  const resolvedStream = new ReadableStream({
    start(controller) {
      resolvedController = controller;
    },
  });

  const mapStream = new ReadableStream({
    start(controller) {
      mapController = controller;
    },
  });

  const bodyStream = new ReadableStream({
    start(controller) {
      bodyController = controller;
    },
  });

  processStreamBackground(template, data, streams, {
    resolved: resolvedController,
    map: mapController,
    body: bodyController,
  }).catch((error) => {
    resolvedController.error(error);
    mapController.error(error);
    bodyController.error(error);
  });

  return { resolvedStream, mapStream, bodyStream };
}

async function processStreamBackground(template, data, streams, controllers) {
  for await (const chunk of readTemplateChunks(template)) {
    controllers.resolved.enqueue(decodeChunk(chunk));
  }

  controllers.resolved.close();
  controllers.map.close();
  controllers.body.close();
}

async function* readTemplateChunks(template) {
  if (typeof template === 'string') {
    yield template;
    return;
  }

  if (template && typeof template.getReader === 'function') {
    const reader = template.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  }

  if (template && typeof template[Symbol.asyncIterator] === 'function') {
    for await (const chunk of template) {
      yield chunk;
    }
    return;
  }

  yield String(template);
}

function decodeChunk(chunk) {
  if (typeof chunk === 'string') {
    return chunk;
  }

  return new TextDecoder().decode(chunk);
}

function parse(resolved, optionalBodyStream = null) {
  return { ir: {}, bodyStream: null };
}

module.exports = { hydrate, parse };
