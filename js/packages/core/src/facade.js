const { hydrate, parse } = require('./pipeline');
const { executeFetch } = require('./execute');

async function build(template, data, streams = []) {
  return { ir: {}, map: [], bodyStream: null };
}

async function execute(template, data, streams = [], config = {}) {
  return new Response();
}

module.exports = { build, execute };
