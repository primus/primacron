# Primacron

[![Version npm](http://img.shields.io/npm/v/primacron.svg?style=flat-square)](http://browsenpm.org/package/primacron)[![Build Status](http://img.shields.io/travis/primus/primacron/master.svg?style=flat-square)](https://travis-ci.org/primus/primacron)[![Dependencies](https://img.shields.io/david/primus/primacron.svg?style=flat-square)](https://david-dm.org/primus/primacron)[![Coverage Status](http://img.shields.io/coveralls/primus/primacron/master.svg?style=flat-square)](https://coveralls.io/r/primus/primacron?branch=master)[![IRC channel](http://img.shields.io/badge/IRC-irc.freenode.net%23primus-00a8ff.svg?style=flat-square)](http://webchat.freenode.net/?channels=primus)

Primacron is an ancient scientist who's responsible for building Unicron, the
evil twin of Primus.

Primacron is a high level and highly opinionated interface for Primus which
provides multi-server logic through `redis` and plain HTTP. It introduces the
concept of forced validation for every single message it receives. This gives
you the guarantee that you can "safely" processes these messages once they are
emitted.

This high level interface is composed out of various Primus plugins that are
maintained by the Primus project:

- **[metroplex](https://github.com/primus/metroplex)** Which is the spark registry.
- **[omega-supreme](https://github.com/primus/omega-supreme)** Adds HTTP based
  broadcasting/messaging between servers.
- **[fortess-maximus](https://github.com/primus/fortress-maximus)** Force validation
  for every single incoming message.
- **[primus-emit](https://github.com/primus/emit)** Emitting for client and server.
- **[mirage](https://github.com/primus/mirage)** Persistent session ids.

The module depends on `redis` as a socket address -> server IP dictionary which
is shared between the various of connected servers. If you do not have `redis`
installed on your server you should download it from http://redis.io

## Installation

The module is distributed through npm and can be installed using.

```
npm install --save primacron
```

## License

MIT
