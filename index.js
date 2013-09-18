'use strict';

var parser = require('url').parse
  , request = require('request')
  , Primus = require('primus')
  , async = require('async');

//
// Cached prototypes to speed up lookups.
//
var toString = Object.prototype.toString
  , slice = Array.prototype.slice
  , undefined;

//
// Noop function.
//
function noop() {}

/**
 * Simple user interface which will optimize our memory usage.
 *
 * @constructor
 * @param {String} account The account id.
 * @param {String} session the session id.
 * @param {String} id The Engine.IO socket id
 * @api private
 */
function User(account, session, id) {
  this.account = account;
  this.session = session;
  this.id = this;
}

/**
 * Create a new Primacron instance.
 *
 * @constructor
 * @param {Redis} redis A Redis client.
 * @param {Object} options Primacron options.
 * @api public
 */
var Primacron = module.exports = function Primacron(redis, options) {
  if (!(this instanceof Primacron)) return new Primacron(redis, options);

  options = options || {};

  //
  // The HTTP routes that we should be listening on.
  //
  this.broadcast = options.broadcast || '/primacron/broadcast';
  this.endpoint = options.endpoint || '/stream/';

  // The Redis client we need to keep connection state.
  this.redis = redis || require('redis').createClient();

  // The root domain of the service, will be used for redirects.
  this.redirect = options.redirect || false;

  // The namespace for the keys that are stored in Redis.
  this.namespace = options.namespace || 'primacron';

  // How long do we maintain state from a single user (in seconds).
  this.timeout = options.timeout || 60 * 15;

  // The network address this server is approachable on for internal HTTP requests.
  this.networkaddress = options.address || 'localhost';

  // The port number that we should use to connect with this server.
  this.port = options.port || null;

  // The transformer we need to use for a real-time connection.
  this.transformer = options.transformer || 'engine.io';

  // The parser we need to use for real-time communication.
  this.parser = options.parser || 'json';

  //
  // These properties will be set once we're initialized.
  //
  this.primus = null;         // Primus server instance.
  this.primusQueue = [];      // Primus command proxy queue.
  this.server = null;         // HTTP server instance.

  //
  // Stores `sockets` by created session ids.
  //
  this.sockets = Object.create(null);
};

//
// The Primacron inherits from the EventEmitter so we can safely emit events
// without creating tail recursion.
//
Primacron.prototype.__proto__ = require('events').EventEmitter.prototype;

//
// Because we are to lazy to combine address + port every single time.
//
Object.defineProperty(Primacron.prototype, 'uri', {
  get: function get() {
    return 'http://'+ [this.networkaddress, this.port].filter(Boolean).join(':');
  }
});

//
// Expose the version number.
//
Primacron.prototype.version = require('./package.json').version;

/**
 * Add a new custom session id generator.
 *
 * @param {Function} generator A custom generator for unique ids.
 * @api public
 */
Primacron.prototype.uuid = function uuid(generator) {
  this.generator = generator;
  return this;
};

/**
 * A simple persistent session generator.
 *
 * @param {Socket} spark Primus Spark.
 * @param {Function} fn Callback.
 * @api private
 */
Primacron.prototype.generator = function generator(spark, fn) {
  fn(undefined, [1, 1, 1, 1].map(function generator() {
    return Math.random().toString(36).substring(2).toUpperCase();
  }).join('-'));
};

/**
 * Simple Engine.io onOpen method handler so we can add data to the handshake.
 *
 * @see 3rd-Eden/engine.io/commit/627fa5b4e794a5c624447bde34ce8ef284a6ba00
 * @param {Socket} socket Engine.IO socket.
 * @param {Function} fn Callback.
 * @api private
 */
Primacron.prototype.initialise = function initialise(socket, fn) {
  var primacron = this;

  //
  // This horrible next tick is required to make a socket.request.query access
  // work. The request is set after the new Socket() constructor is invoked and
  // as the new Socket calls the `engineio.onOpen` method synchronously it will
  // not have access to it yet. By wrapping our generator in a `nextTick` we can
  // be certain that the socket has a `request` property and that our generator
  // can use it.
  //
  process.nextTick(function ticktock() {
    async.waterfall([
      //
      // 1: Generate a session id.
      //
      primacron.generator.bind(this, socket),

      //
      // 2: Add the session, account and id so we can find this user back.
      //
      function connect(data, next) {
        var account = socket.request.query.account;

        //
        // Store the session in the query parameters.
        //
        socket.request.query.session = data;

        //
        // Primus is using the same socket.id as id for the spark connection so
        // we can safely store that.
        //
        primacron.connect(account, data, socket.id, function (err, members) {
          if (!err) socket.tail = members;

          return next(err, { session: data, account: account });
        });
      }
    ], fn);
  });
};

/**
 * Intercept HTTP requests and handle them accordingly.
 *
 * @param {Request} req HTTP request instance.
 * @param {Response} res HTTP response instance.
 * @api private
 */
Primacron.prototype.intercept = function intercept(req, res) {
  if (
       'put' === (req.method || '').toLowerCase()
    && this.broadcast === req.uri.pathname
  ) {
    //
    // Add some identifying headers.
    //
    res.setHeader('X-Powered-By', 'Primacron/v'+ this.version);
    return this.incoming(req, res);
  }

  //
  // This is an unknown request, let's just assume that this user is just
  // exploring our server with the best intentions and redirect him to the
  // redirection domain.
  //
  if (this.redirect) {
    res.statusCode = 301;
    res.setHeader('Location', this.redirect);
    return res.end('');
  }

  //
  // Well, fuck it, kill it, with fire!
  //
  this.end('bad request', res);
};

/**
 * Set the network address where this server is accessible on.
 *
 * @param {String} address Network address.
 * @param {String} port The port number.
 * @api public
 */
Primacron.prototype.network = function network(address, port) {
  if (address) this.networkaddress = address;
  if (port) this.port = port;

  return this;
};

/**
 * Find the socket by session id.
 *
 * @param {String} session The session id we want to find.
 * @returns {Socket} The matching Primus spark.
 * @api private
 */
Primacron.prototype.socket = function socket(session) {
  return this.sockets[session];
};

/**
 * Add a new connection.
 *
 * @param {String} account Account id.
 * @param {String} session Session id.
 * @param {String} id Connection id.
 * @param {Function} fn Optional callback.
 * @api private
 */
Primacron.prototype.connect = function connect(account, session, id, fn) {
  var key = this.namespace +'::'+ account +'::'+ session
    , value = this.uri +'@'+ id
    , primacron = this;

  this.redis.multi()
    .setex(key, this.timeout, value)    // Save our update location.
    .smembers(key +'::pipe')            // Retrieve all users that are listening.
  .exec(function setx(err, replies) {
    var data;

    //
    // We need to "parse" the replies to determine if we actually received an
    // error. Because this fucking pieces of shitty `node-redis` library doesn't
    // correctly parse error responses for MULTI/EXEC calls.
    //
    replies.some(function some(reply) {
      if (!err && ~reply.indexOf('ERR'))  err = new Error(reply);

      return !!err;
    });

    if (fn) fn.call(this, err, replies[1]);
    if (err) return primacron.emit('error::connect', err, {
      key: key,
      value: value
    });
  });

  return this;
};

/**
 * Remove a connection.
 *
 * @param {String} account Account id.
 * @param {String} session Session id.
 * @param {String} id Connection id.
 * @param {Function} fn Optional callback.
 * @api private
 */
Primacron.prototype.disconnect = function disconnect(account, session, id, fn) {
  var key = this.namespace +'::'+ account +'::'+ session
    , value = this.uri +'@'+ id
    , primacron = this;

  this.redis.del(key, function del(err) {
    if (fn) fn.apply(this, arguments);
    if (err) return primacron.emit('error::disconnect', err, {
      key: key,
      value: value
    });
  });

  return this;
};

/**
 * Find a server for a given session id.
 *
 * @param {String} account Observe.it account id.
 * @param {String} session Session id of the user.
 * @param {Function} fn Callback.
 * @api private
 */
Primacron.prototype.find = function find(account, session, fn) {
  var key = this.namespace +'::'+ account +'::'+ session;

  this.redis.get(key, function parse(err, data) {
    if (err || !data) return fn(err, data);

    //
    // The format of the response is <serverhost:port>@<socket id>, just split it.
    //
    data = data.split('@');
    fn(undefined, data[0], data[1]);
  });

  return this;
};

/**
 * Send a message to the given id.
 *
 * @param {String} account Observe.it account id.
 * @param {String} session Session id of the user.
 * @param {String} message Message.
 * @param {Function} fn Callback.
 * @api public
 */
Primacron.prototype.forward = function forward(account, session, message, fn) {
  var primacron = this;

  return this.find(account, session, function found(err, server, id) {
    if (err || !server) return fn(err || new Error('Unknown session id '+ session));

    primacron.communicate(server, id, message, fn);
  });
};

/**
 * Communicate with other servers.
 *
 * @param {String} server The server address.
 * @param {String} id The Socket id.
 * @param {Mixed} message The message you want to send.
 * @param {Function} fn Callback
 * @api private
 */
Primacron.prototype.communicate = function communicate(server, id, message, fn) {
  request({
    uri: server + this.broadcast,
    method: 'PUT',
    json: {
      id: id,           // The id of the socket that should receive the data.
      message: message  // The actual message.
    }
  }, function requested(err, response, body) {
    var status = (response || {}).statusCode;

    if (err || status !== 200) {
      err = err || new Error('Invalid status code ('+ status +') returned');
      err.status = status;
      err.body = body;

      return fn(err);
    }

    //
    // We only have successfully send the message when we received
    // a statusCode 200 from the targeted server.
    //
    fn(undefined, body);
  });
};

/**
 * Pipe two different sockets.
 *
 * TODO: As we are following socket, we probably need to mark this socket as
 * `tail` as well..
 *
 * @param {Socket} socket The socket that wants to follow an account.
 * @param {String} account Account id.
 * @param {String} session Session id.
 * @param {Function} fn Callback.
 * @api public
 */
Primacron.prototype.pipe = function pipe(socket, account, session, fn) {
  fn = fn || noop;

  if (account !== socket.query.account) {
    return fn(new Error('Cannot follow other accounts'));
  }

  var key = this.namespace +'::'+ account +'::'+ session +'::pipe'
    , value = this.uri +'@'+ socket.id
    , primacron = this;

  this.redis.sadd(key, value, function follow(err) {
    if (err) return fn(err);

    primacron.forward(account, session, [ value ], fn);
  });

  return this;
};

/**
 * An other server wants to send something one of our connected sockets.
 *
 * @param {Request} req HTTP Request instance.
 * @param {Respone} res HTTP Response instance.
 * @api private
 */
Primacron.prototype.incoming = function incoming(req, res) {
  var primus = this.primus
    , primacron = this
    , buff = '';

  //
  // Receive the data from the socket. The `setEncoding` ensures that Unicode
  // chars are correctly buffered and parsed before the `data` event is emitted.
  //
  req.setEncoding('utf8');
  req.on('data', function data(chunk) { buff += chunk; });
  req.once('end', function end() {
    primus.decoder(buff, function (err, data) {
      if (err) {
        primacron.end('broken', res);
        return primacron.emit('error::invalid', err, {
          raw: buff,
          request: req
        });
      }

      if (
          typeof data !== 'object'                // Message should be an object.
        || Array.isArray(data)                    // Not an array..
        || !('message' in data && 'id' in data)   // And have the required fields.
      ) {
        primacron.end('invalid', res);
        return primacron.emit('error::invalid', new Error('Invalid packet received'), {
          raw: buff,
          request: req
        });
      }

      //
      // Try to find the connected socket on our server.
      //
      if (!(data.id in primacron.primus.connections)) {
        return primacron.end('unknown socket', res);
      }

      //
      // Write the message to the client.
      //
      var socket = primacron.primus.connections[data.id];

      //
      // Determine how we should handle this message.
      //
      switch (toString.call(data.message).slice(8, -1)) {
        case 'String':
          socket.emit('primacron::pipe', data.message);
        break;

        case 'Array':
          socket.emit('primacron::tail', data.message);
        break;

        default:
          socket.emit('primacron', data.message);
      }

      primacron.end('sending', res);
    });
  });

  return this;
};

/**
 * Require validation for every single message that passes in our message
 * system.
 *
 * @param {String} event The name of the event that we need to validate.
 * @param {Function} validator The validation function.
 * @api public
 */
Primacron.prototype.validate = function validate(event, validator) {
  var callbackargument = validator.length - 1
    , primacron = this;

  return this.on('validate::'+ event, function validating() {
    var data = slice.call(arguments, 0)
      , raw = data.pop()
      , user = data.pop();

    //
    // We know amount of arguments the validator function expects so we use this
    // information to place the validation callback at the last argument even if
    // the amount varies.
    //
    data[callbackargument] = function callback(err, ok, tranformed) {
      if (err || ok === false) {
        err = err || new Error('Failed to validate the data');

        return primacron.emit('error::validation', err, {
          event: event,
          raw: raw,
          user: user
        });
      }

      //
      // Emit the event as it's validated.
      //
      data = data.slice(0, callbackargument);
      data.unshift('stream::'+ event);
      data.push(raw);
      data.push(user);

      primacron.emit.apply(primacron, data);

      //
      // Now that everything is validated, we are going to check if we have any
      // socket tail's who want to receive this data.
      //
      if (!primacron.primus || !(user.id in primacron.primus.connections)) return;
      var socket = primacron.primus.connections[user.id];

      socket.tail.forEach(function tail(gator) {
        if (!gator) return;

        var data = gator.split('@');
        primacron.communicate(data[0], data[1], raw, noop);
      });
    };

    validator.apply(this, data);
  });
};

/**
 * A new Primus connection.
 *
 * @param {Spark} spark The primus spark.
 * @api private
 */
Primacron.prototype.connection = function connection(spark) {
  var session = spark.query.session
    , account = spark.query.account
    , primacron = this
    , id = spark.id
    , user;

  //
  // A simple user packet that would give us enough information on who the fuck
  // the user is.
  //
  user = new User(account, session, id);

  //
  // Store a reference for the socket.
  //
  this.sockets[session] = spark;

  //
  // Parse messages.
  //
  spark.on('data', function preparser(data, raw) {
    var emitted;

    //
    // The received data should be either be an Object or Array, JSON does
    // support strings and numbers but we don't want those :).
    //
    if ('object' !== typeof data) {
      return primacron.emit('error::invalid', new Error('Not an object'), {
        user: user,
        raw: raw
      });
    }

    //
    // Check if the message was formatted as an event, if it is we need to
    // prefix it with `stream:` to namespace the event and prevent collisions
    // with other internal events. And this also ensures that we will not
    // override existing Engine.IO events and cause loops when an attacker
    // emits an `message` event.
    //
    if (data && 'object' === typeof data && 'event' in data) {
      data.args.unshift('validate::'+ data.event);
      data.args.push(user);
      data.args.push(raw);

      if (!primacron.emit.apply(primacron, data.args)) {
        primacron.emit('error::validation', new Error('Validator missing'), {
          event: data.event,
          user: user,
          raw: raw
        });
      }
    } else if (!primacron.emit('validate::message', data, user, raw)) {
      primacron.emit('error::validation', new Error('Validator missing'), {
        event: 'data',
        user: user,
        raw: raw
      });
    }
  });

  //
  // Listen for external requests.
  //
  spark.on('primacron::pipe', function pipe(data) {
    spark.write(data);
  });

  //
  // Listen for new followers
  //
  spark.on('primacron::tail', function tail(members) {
    members.forEach(function follower(member) {
      if (~spark.tail.indexOf(member)) return;

      spark.tail.push(member);
    });
  });

  //
  // Clean up the socket connection. Remove all listeners.
  //
  spark.once('end', function disconnect() {
    primacron.disconnect(account, session, id);
    delete primacron.sockets[session];
    spark.removeAllListeners();
  });
};

/**
 * Proxy events from Engine.IO or the HTTP server directly to our Primacron
 * instance. This is done without throwing errors because we check beforehand if
 * there are listeners attached for the given event before we emit it.
 *
 * @param {String} event Name of the event we are emitting.
 * @api private
 */
Primacron.prototype.proxy = function proxy(event) {
  var listeners = this.listeners(event) || [];

  if (listeners.length) this.emit.apply(this, arguments);
};

/**
 * Return a default response for the given request.
 *
 * @param {String} type The name of the response we should send.
 * @param {Response} res HTTP response object.
 * @returns {Buffer} Pre compiled response buffer.
 * @api private
 */
Primacron.prototype.end = function end(type, res) {
  var compiled = Primacron.prototype.end
    , msg = compiled[type] || compiled['bad request'];

  if (!res) return msg;

  res.statusCode = msg.json.status || 400;
  res.setHeader('Content-Type', 'application/json');
  res.end(msg);

  return msg;
};

//
// Generate the default responses, they are stored in Buffers to reduce
// pointless stringify operations. The document is stored as a backup so we can
// retrieve the statusCode and correctly answer the request.
//
[
  {
    status: 400,
    type: 'broken',
    description: 'Received an incorrect JSON document.'
  },
  {
    status: 400,
    type: 'bad request',
    description: 'Bad request, make sure you are hitting the correct endpoint.'
  },
  {
    status: 400,
    type: 'invalid',
    description: 'Received an invalid JSON document.'
  },
  {
    status: 404,
    type: 'unknown socket',
    description: 'The requested spark was not found.'
  },
  {
    status: 200,
    type: 'sending',
    description: 'Sending the message to the spark.'
  }
].forEach(function precompile(document) {
  Primacron.prototype.end[document.type] = new Buffer(JSON.stringify(document));
  Primacron.prototype.end[document.type].json = document;
});

/**
 * Destroy the Primacron server and clean up all it's references.
 *
 * @api public
 */
Primacron.prototype.destroy = function destroy(fn) {
  var primacron = this;

  this.server.removeAllListeners('request');
  this.primus.removeAllListeners('connection');
  this.primus.destroy(function destroy() {
    primacron.redis.end();
    primacron.server.removeAllListeners('error');

    (fn || noop).apply(this, arguments);
  });

  return this;
};

/**
 * This argument accepts what ever you want to send to a regular server.listen
 * method.
 *
 * @api public
 */
Primacron.prototype.listen = function listen() {
  var args = slice.call(arguments, 0)
    , port = +args[0];

  //
  // Create the HTTP server.
  //
  if (port) this.port = port;

  this.server = require('http').createServer(this.intercept.bind(this));
  this.server.on('listening', this.proxy.bind(this, 'listening'));
  this.server.on('error', this.proxy.bind(this, 'error'));
  this.server.on('close', this.proxy.bind(this, 'close'));

  //
  // Setup the real-time engine.
  //
  this.primus = new Primus(this.server, {
    transformer: this.transformer,
    pathname: this.endpoint,
    parser: this.parser
  });

  //
  // This is an engine.io specific hack that is made in a custom fork that we're
  // using of engine.io. This fork allows us to send data to the user during the
  // handshake.
  //
  this.primus.transformer.service.onOpen = this.initialise.bind(this);
  this.primus.use('events', require('./plugins/events'));
  this.primus.on('connection', this.connection.bind(this));
  this.primus.save(__dirname +'/dist/primacon.js');

  //
  // Process queued commands for primus.
  //
  if (this.primusQueue.length) this.primusQueue.forEach(function (queued) {
    this.primus[queued.method].apply(this.primus, queued.args);
  }, this);

  this.primusQueue.length = 0;

  //
  // Proxy all arguments to the server.
  //
  this.server.listen.apply(this.server, args);

  return this;
};

//
// Add missing methods of a regular HTTP server that we can proxy from our
// internal `this.server` instance.
//
['address'].forEach(function missing(method) {
  Primacron.prototype[method] = function proxy() {
    this.server[method].apply(this.server, arguments);
    return this;
  };
});

//
// Add missing methods of a Primus instance.
//
['use', 'library', 'save', 'transform'].forEach(function missing(method) {
  Primacron.prototype[method] = function proxy() {
    //
    // Primus is only availble after we've listened to the server, so we just
    // want to queue up all these arguments untill we've actually listend.
    //
    if (!this.primus) {
      this.primusQueue.push({ method: method, args: arguments });
      return this;
    }

    this.primus[method].apply(this.primus, arguments);
    return this;
  };
});

/**
 * Create a new server.
 *
 * @param {Redis} redis A Redis client.
 * @param {Object} options Configuration.
 * @api public
 */
Primacron.createServer = function createServer(redis, options) {
  return new Primacron(redis, options);
};

/**
 * Make the module extendable.
 *
 * @type {Function}
 */
Primacron.extend = require('extendable');

//
// Expose the User object.
//
Primacron.User = User;
