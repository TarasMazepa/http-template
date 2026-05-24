const { hydrate, parse } = require('./src/pipeline');
const { build, execute } = require('./src/facade');
const { executeFetch } = require('./src/execute');

module.exports = {
  hydrate, parse,
  build, execute,
  executeFetch
};
