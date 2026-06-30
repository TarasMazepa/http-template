const fs = require('node:fs');
const { build, execute } = require('@httpt/core');

async function runCommand(file, flags) {
  if (!file) {
    throw new Error('Missing template file');
  }

  if (!flags.data) {
    throw new Error('Missing required --data flag');
  }

  const template = fs.readFileSync(file, 'utf-8');
  const data = JSON.parse(fs.readFileSync(flags.data, 'utf-8'));
  const isDryRun = flags['dry-run'] || flags.dryRun;

  if (isDryRun || flags.out || flags.output) {
    const { ir } = await build(template, data);
    const outputFile = flags.out || flags.output;

    if (outputFile) {
      fs.writeFileSync(outputFile, JSON.stringify(ir, null, 2));
      console.log(`Written to ${outputFile}`);
      return;
    }

    console.log(JSON.stringify(ir, null, 2));
    return;
  }

  const response = await execute(template, data, [], {
    scheme: flags.scheme || 'https',
  });

  const responseText = await response.text();
  process.stdout.write(responseText);
}

module.exports = runCommand;
