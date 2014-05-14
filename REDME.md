```
CAUTION:

This module is still under heavy development, it was released as OpenSource to
give people insight on how you could do a multi-server architecture that should
theoretically scale indefinitly.
```

# Primacron

[![Build Status](https://travis-ci.org/observing/primacron.png)](https://travis-ci.org/observing/primacron)
[![NPM version](https://badge.fury.io/js/primacron.png)](http://badge.fury.io/js/primacron)

Primacron is an ancient scientist who's responsible for building Unicron, the
evil twin of Primus.

Primacron is a high level and highly opinionated interface for Primus which
provides multi-server logic through `redis` and plain HTTP. It introduces the
concept of forced validation for every single message it receives. This gives
you the guarantee that you can "safely" processes these messages once they are
emitted.

The module depends on `redis` as a socket address -> server IP dictionary which
is shared between the various of connected servers. If you do not have `redis`
installed on your server you should download it from http://redis.io

## Installation

The module is distributed through npm:

```
npm install --save primacron redis
```

The module it self does not depend on Redis, but requires a working Redis client
as argument. This is why you should also install `redis` as an dependency, but
this is done automatically if you use the command above.

## Getting started

The Primacron constructor is exposed as primary interface. This makes it easier
to extend and initialise. There is only one **required** argument and that is a
reference to a constructed `redis` client. If none is supplied the module will
try and connect to `localhost` with the default port number.

```js
'use strict';

var Primacron = require('primacron')
  , redis = require('redis');

var server = new Primacron(redis.createClient() /*, { options } */);
```

There are some alternate ways to connect, if you're a syntax sugar junky:

```js
'use strict';

var primacron = require('primacron')
  , redis = require('redis');

var server = primacron.createServer(redis /*, { options } */);
```
```
'use strict';

var primacron = require('primacron')
  , redis = require('redis');

var server = primacron(redis.createClient() /*, { options } */);
```

The second argument of Primus is an options object which allows you to fully
configure Primacron and Primus. The following options are available:

Name                | Description                             | Default       
--------------------|-----------------------------------------|---------------
broadcast           | HTTP route to receive broadcasts        | `/primacron/broadcast`
endpoint            | HTTP route to receive connections       | `/stream`
redirect            | Redirect unknown request to this URL    | `false`
namespace           | The namespace for the Redis keys        | `primacron`
timeout             | How long we should maintain user state  | `60 * 15`
address             | The address of the server               | `localhost`
port                | The port number to connect with         | `null`
transformer         | The Primus transformer                  | `engine.io`
parser              | The Primus parser                       | `json`

Once the server instance is created, it needs to listen to a port number, just
like you're used to with regular `net.Server` instances. It follows the same
argument pattern as it just takes the arguments and passes it in to a http
server. If you supply a port number, this will override the `options.port`.

```js
server.listen(8080, function () {
  // listening
});
```
