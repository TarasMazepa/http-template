async function hydrate(template, data, streams = []) {
  return { resolved: '', map: [], bodyStream: null };
}

function parse(resolved, optionalBodyStream = null) {
  return { ir: {}, bodyStream: null };
}

module.exports = { hydrate, parse };
