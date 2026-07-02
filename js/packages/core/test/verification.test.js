const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  hydrate,
  verifyContract,
  validateStreamReferences,
  prepareHydrationContext,
} = require('../src/pipeline.js');

describe('Static contract verification', () => {
  it('should return true when syntax and expected arguments match', () => {
    const template = [
      'GET /users/{{ user-id | url }} HTTP/1.1',
      'Host: api.example.com',
      'Authorization: Bearer {{ auth-token | raw }}',
      '',
    ].join('\n');

    assert.equal(verifyContract(template, ['user-id', 'auth-token']), true);
  });

  it('should reject missing contract arguments', () => {
    assert.throws(
      () => verifyContract('GET /{{ user-id | url }} HTTP/1.1\n', []),
      (error) => error.name === 'MissingArgumentError' && error.missing.includes('user-id')
    );
  });

  it('should reject extra contract arguments', () => {
    assert.throws(
      () => verifyContract('GET /{{ user-id | url }} HTTP/1.1\n', ['user-id', 'unused']),
      (error) => error.name === 'UnexpectedArgumentError' && error.extra.includes('unused')
    );
  });

  it('should reject malformed template tags and unsupported functions', () => {
    assert.throws(
      () => verifyContract('GET /{{ user-id | mystery }} HTTP/1.1\n', ['user-id']),
      (error) => error.name === 'TemplateSyntaxError'
    );

    assert.throws(
      () => verifyContract('GET /{{ user-id | url HTTP/1.1\n', ['user-id']),
      (error) => error.name === 'TemplateSyntaxError' && Number.isInteger(error.index)
    );
  });
});

describe('Stream reference validation', () => {
  it('should reject ambiguous implicit provided stream references', () => {
    assert.throws(
      () => validateStreamReferences({
        first: { type: 'provided' },
        second: { type: 'provided', content: 1 },
      }),
      (error) => error.name === 'TemplateSyntaxError'
    );
  });

  it('should reject duplicate provided stream indexes', () => {
    assert.throws(
      () => validateStreamReferences({
        first: { type: 'provided', content: 0 },
        second: { type: 'provided', content: 0 },
      }),
      (error) => error.name === 'TemplateSyntaxError'
    );
  });

  it('should extract native streams from data and make them addressable as provided references', () => {
    const stream = Buffer.from('stream-value');
    const { data, streams } = prepareHydrationContext({ upload: stream });

    assert.deepEqual(data.upload, { type: 'provided', content: 0 });
    assert.strictEqual(streams[0], stream);

    const template = 'POST /upload HTTP/1.1\nHost: example.com\n\n{{ upload | stream-as-utf8 }}';
    const { resolved } = hydrate(template, { upload: stream });
    assert.equal(resolved, 'POST /upload HTTP/1.1\nHost: example.com\n\nstream-value');
  });
});
