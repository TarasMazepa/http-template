const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseArgs } = require('../src/parser.js');

describe('CLI argument parser', () => {
  it('should accept flags before the file path', () => {
    const parsed = parseArgs(['node', 'httpt', 'run', '--scheme', 'https', 'submit.httpt']);

    assert.deepEqual(parsed, {
      command: 'run',
      file: 'submit.httpt',
      flags: { scheme: 'https' },
    });
  });

  it('should accept flags after the file path', () => {
    const parsed = parseArgs(['node', 'httpt', 'run', 'submit.httpt', '--scheme', 'http']);

    assert.deepEqual(parsed, {
      command: 'run',
      file: 'submit.httpt',
      flags: { scheme: 'http' },
    });
  });

  it('should preserve repeated flags as arrays', () => {
    const parsed = parseArgs([
      'node',
      'httpt',
      'run',
      'submit.httpt',
      '--stream',
      'a.bin',
      '--stream',
      'b.bin',
    ]);

    assert.deepEqual(parsed, {
      command: 'run',
      file: 'submit.httpt',
      flags: { stream: ['a.bin', 'b.bin'] },
    });
  });
});
