const { hydrate, parse } = require('./pipeline');
const { dispatchFetch } = require('./dispatch');

async function build(template, data, streams = []) {
  const { resolved, map, bodyStream } = hydrate(template, data, streams);
  const parsed = parse(resolved, bodyStream);

  return {
    ir: parsed.ir,
    map,
    bodyStream: parsed.bodyStream,
  };
}

async function execute(template, data, streams = [], config = {}) {
  const scheme = config.scheme || 'https';
  const { ir, bodyStream } = await build(template, data, streams);

  return dispatchFetch(ir, scheme, bodyStream);
}

module.exports = { build, execute };
