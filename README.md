# Primacron

[![Version npm](https://img.shields.io/npm/v/primacron.svg?style=flat-square)](https://www.npmjs.com/package/primacron)[![Build Status](https://img.shields.io/github/workflow/status/primus/primacron/CI/master?label=CI&style=flat-square)](https://github.com/primus/primacron/actions?query=workflow%3ACI+branch%3Amaster)

Primacron is an ancient scientist who's responsible for building Unicron, the
evil twin of Primus.

Primacron is a high level and highly opinionated interface for Primus which
provides multi-server logic through `redis` and plain HTTP. It introduces the
concept of forced validation for every single message it receives. This gives
you the guarantee that you can "safely" processes these messages once they are
emitted.

This high level interface is composed out of various Primus plugins that are
maintained by the Primus project:

- **[metroplex](https://github.com/primus/metroplex)** Which is the spark
  registry.
- **[omega-supreme](https://github.com/primus/omega-supreme)** Adds HTTP based
  broadcasting/messaging between servers.
- **[fortess-maximus](https://github.com/primus/fortress-maximus)** Force
  validation for every single incoming message.
- **[primus-emit](https://github.com/primus/emit)** Emitting for client and
  server.
- **[mirage](https://github.com/primus/mirage)** Persistent session ids.

The module depends on [redis](http://redis.io) which is used to store a
socket address -> server IP dictionary shared among the servers. Please use
http://redis.io to get detailed installation instructions.

## Installation

The module is distributed through npm and can be installed using.

```
npm install --save primacron
```

## API

The module exports a constructor function which takes two optional arguments.

### Primacron([server][, options])

Returns a new Primacron instance.

**Arguments**

- `server` - Optional - An http/s server instance, automatically created if not
  provided.
- `options` - Optional - An object with the configuration options. You can use
  any option supported by Primus and the above mentioned plugins.

**Example**

```js
const Primacron = require('primacron');

const primacron = new Primacron({ port: 8080 });

primacron.validate('data', (message, next) => {
  if (typeof message !== 'number') return next(new Error('Validation failed'));

  next();
});

primacron.on('data', (spark, message) => console.log(message));
primacrom.on('invalid', (err) => console.error(err.stack));

primacron.on('listening', () => {
  const bound = primacron.address();
  console.log('server listening on %s:%d', bound.address, bound.port);
});
```

## License

[MIT](LICENSE)
