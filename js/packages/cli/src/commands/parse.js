const fs = require('node:fs');
const { parse } = require('@httpt/core');
function parseCommand(file, flags) {
  if (!file) {
    throw new Error('Missing resolved .httpt-r file');
  }

  const resolved = fs.readFileSync(file, 'utf-8');
  const { ir } = parse(resolved);

  const outputFile = flags.out || flags.output || file.replace(/\.httpt-r$/, '.httpt-ir');
  fs.writeFileSync(outputFile, JSON.stringify(ir, null, 2));
  console.log(`Written to ${outputFile}`);
}

module.exports = parseCommand;
