const {
  hydrate,
  hydrateAsync,
  parse,
  parseAsync,
  verifyContract,
  validateStreamReferences,
  prepareHydrationContext,
} = require('./src/pipeline');
const { build, execute } = require('./src/facade');
const { dispatchFetch } = require('./src/dispatch');

module.exports = {
  hydrate, hydrateAsync,
  parse, parseAsync,
  verifyContract,
  validateStreamReferences,
  prepareHydrationContext,
  build, execute,
  dispatchFetch
};
