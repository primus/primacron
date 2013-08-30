```
WORD OF CAUTION:

This module is still under developmented, it was Open Sourced to give people some
insight on how you could do scaling with Primus and build a module on top of it.
```

# Primacron

Primacron is a small API wrapper for Engine.IO that takes care of our "scaling" and
multi server logic. This keeps our services as light as possible so we can focus
on our business logic instead of other issues.

## Installation

The module can be installed through npm:

```
npm install --save primacron
```

## Creating your first server

The module exposes it's constructor as primary interface. This makes it easy to
extend and to initialise:

```js
var Primacron = require('primacron')
  , redis = require('redis');

var server = new Primacron(redis.createClient(), { options })
```

Or if want some alternate syntax you could use:

```js
var primacron = require('primacron')
  , redis = require('redis');

var server = primacron.createServer(redis, { options });
```

And even:

```
var primacron = require('primacron')
  , redis = require('redis');

var server = primacron(redis.createClient(), { options })
```

Once you've created your server instance, it needs to listen to port number.
This works just like a regular `net.Server` instance using a `.listen` method.
All the arguments that are supplied here are directly proxied to the HTTP
server.

```js
server.listen(8080, function () {
  // listening
});
```

## Connecting

The server exposes the `engine.io` endpoint as `/stream/` by default path. The
server assumes that all connections will be made with an `account` parameter in
the query string.

## Error events

To be a as module agnostic as possible, we don't log errors or broken code
instead we emit namespaced `error::<errtype>` events. These events can be
listend on by the applications and decide if they want to log it.

The following error events are emitted:

<dl>
  <dt>error::connect</dt>
  <dd><strong>key, value</strong></dd>
  <dd>
    We failed to store our connection in the provided redis database. The
    connection cannot be found by other node processes. So no broadcasting would
    be possible. This should be seen as a critical error.
  </dd>

  <dt>error::disconnect</dt>
  <dd><strong>key, value</strong></dd>
  <dd>
    We failed to remove the connection in the provided redis database. While it
    should automatically expire it could result in false positives and pointless
    broadcasts to the given server. This isn't a critical error but could
    indicate database failure.
  </dd>

  <dt>error::json</dt>
  <dd><strong>message</strong></dd>
  <dd>
    We failed to parse the received message by our decoder. This shouldn't
    happen ever, if it does you could assume that some is trying to crash the
    server or to find back doors. This should be seen a critical error.
  </dd>

  <dt>error::invalid</dt>
  <dd><strong>message</strong></dd>
  <dd>
    We received a JSON document, but it wasn't an Object.. Someone is tyring to
    do fishy things with the server and action should be taken.. Cause as above.
  </dd>

  <dt>error::validation</dt>
  <dd><strong>event, error</strong></dd>
  <dd>
    The received message event was invalid.
  </dd>
</dl>
