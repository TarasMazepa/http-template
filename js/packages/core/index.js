const { hydrate, parse } = require('./src/pipeline');
const { build, execute } = require('./src/facade');
const { dispatchFetch } = require('./src/dispatch');

module.exports = {
  hydrate, parse,
  build, execute,
  dispatchFetch
};
