const fs = require('node:fs');
const { hydrate } = require('@httpt/core');

function hydrateCommand(file, flags) {
  if (!file) {
    throw new Error('Missing template file');
  }

  if (!flags.data) {
    throw new Error('Missing required --data flag');
  }

  const template = fs.readFileSync(file, 'utf-8');
  const data = JSON.parse(fs.readFileSync(flags.data, 'utf-8'));
  const { resolved, map } = hydrate(template, data);
  const outputFile = flags.out || flags.output || `${file}-r`;

  fs.writeFileSync(outputFile, resolved);
  console.log(`Written to ${outputFile}`);

  if (flags['shift-map'] || flags.map) {
    const mapFile = flags.map === true || !flags.map ? `${file}-map` : flags.map;
    fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
    console.log(`Written to ${mapFile}`);
  }
}

module.exports = hydrateCommand;
