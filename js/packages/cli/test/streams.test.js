const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadStreamsFromFlags } = require('../src/streams.js');

describe('CLI stream loading', () => {
  it('should load --stream files as native buffers in order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'httpt-streams-'));
    const first = path.join(dir, 'first.txt');
    const second = path.join(dir, 'second.txt');
    fs.writeFileSync(first, 'first');
    fs.writeFileSync(second, 'second');

    const streams = loadStreamsFromFlags({ stream: [first, second] });

    assert.deepEqual(streams.map((stream) => stream.toString('utf8')), ['first', 'second']);
  });
});
