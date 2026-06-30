#!/usr/bin/env node

const { parseArgs } = require('./parser');
const hydrateCommand = require('./commands/hydrate');
const parseCommand = require('./commands/parse');
const emitCommand = require('./commands/emit');
const runCommand = require('./commands/run');

async function main() {
  const { command, file, flags } = parseArgs(process.argv);

  switch (command) {
    case 'hydrate':
      await hydrateCommand(file, flags);
      break;
    case 'parse':
      await parseCommand(file, flags);
      break;
    case 'emit':
      await emitCommand(file, flags);
      break;
    case 'run':
      await runCommand(file, flags);
      break;
    default:
      console.log(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
