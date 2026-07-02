const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const verifyCommand = require('../src/commands/verify.js');

describe('CLI verify command', () => {
  it('should verify a template against expected arguments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'httpt-verify-'));
    const templateFile = path.join(dir, 'request.httpt');
    fs.writeFileSync(templateFile, 'GET /{{ user-id | url }} HTTP/1.1\nHost: example.com\n');

    assert.doesNotThrow(() => verifyCommand(templateFile, { expect: 'user-id' }));
  });
});
