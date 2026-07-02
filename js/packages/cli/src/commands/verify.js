const fs = require('node:fs');
const { verifyContract } = require('@httpt/core');
const { normalizeFlagList } = require('../streams');

function verifyCommand(file, flags) {
  if (!file) {
    throw new Error('Missing template file');
  }

  const template = fs.readFileSync(file, 'utf-8');
  const expectedArguments = normalizeFlagList(flags.expect || flags.expected || flags.arg);
  verifyContract(template, expectedArguments);
  console.log('Contract verified');
}

module.exports = verifyCommand;
