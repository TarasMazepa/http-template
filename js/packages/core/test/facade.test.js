const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const { build, hydrateAsync, parseAsync } = require('../index.js');

describe('SDK facade polymorphic inputs', () => {
  it('should build from a Node readable template stream', async () => {
    const template = Readable.from([
      'GET /users/{{ user-id | url }} HTTP/1.1\n',
      'Host: example.com\n',
    ]);

    const { ir } = await build(template, { 'user-id': 'a b' });

    assert.deepEqual(ir, {
      'schema-version': '1.0',
      method: 'GET',
      host: 'example.com',
      uri: '/users/a%20b',
      version: 'HTTP/1.1',
      headers: [],
    });
  });

  it('should hydrate and parse asynchronously from byte inputs', async () => {
    const { resolved } = await hydrateAsync(Buffer.from('GET / HTTP/1.1\nHost: example.com\n'), {});
    const { ir } = await parseAsync(Buffer.from(resolved));

    assert.equal(ir.host, 'example.com');
  });
});
