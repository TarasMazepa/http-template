const fs = require('node:fs');

function normalizeFlagList(value) {
  if (value == null || value === false) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function loadStreamsFromFlags(flags) {
  const streamPaths = normalizeFlagList(flags.stream || flags.streams);
  return streamPaths.map((streamPath) => {
    if (streamPath === true) {
      throw new Error('Missing path for --stream flag');
    }
    return fs.readFileSync(streamPath);
  });
}

module.exports = { loadStreamsFromFlags, normalizeFlagList };
