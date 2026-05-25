const { describe, it } = require('node:test');
const assert = require('node:assert');
const { binarizeIr, normalizeForEchoServer } = require('../index.js');

describe('Test Utilities', () => {
  it('binarizeIr text conversion', () => {
    const inputIR = {
      method: 'POST',
      body: { type: 'text', content: 'hello' }
    };

    const expectedIR = {
      method: 'POST',
      body: { type: 'base64', content: Buffer.from('hello', 'utf8').toString('base64') } // 'aGVsbG8='
    };

    const result = binarizeIr(inputIR);
    assert.deepEqual(result, expectedIR);
  });

  it('normalizeForEchoServer lowercases headers and handles GET body for fetch', () => {
    const expectedIR = {
      method: 'GET',
      headers: [
        { name: 'X-Custom-Header', value: 'Value' },
        { name: 'Host', value: 'localhost:8080' } // Should be deleted
      ],
      body: { type: 'text', content: 'should-be-deleted' }
    };

    const serverIR = {
      method: 'GET',
      headers: [
        { name: 'X-Custom-Header', value: 'Value' }
      ]
    };

    normalizeForEchoServer(expectedIR, serverIR, 'fetch');

    assert.deepEqual(expectedIR.headers, [
      { name: 'x-custom-header', value: 'Value' }
    ]);
    assert.strictEqual(expectedIR.body, undefined);

    assert.deepEqual(serverIR.headers, [
      { name: 'x-custom-header', value: 'Value' }
    ]);
  });
});
