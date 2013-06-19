'use strict';

var Engine = require('engine.io').Server
  , Socket = require('engine.io').Socket
  , parser = require('url').parse
  , request = require('request')
  , async = require('async');

//
// Cached prototypes to speed up lookups.
//
var toString = Object.prototype.toString
  , slice = Array.prototype.slice;

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
 * Create a new Scaler instance.
 *
 * @constructor
 * @param {Redis} redis A Redis client.
 * @param {Object} options Scaler options.
 * @api public
 */
var Scaler = module.exports = function Scaler(redis, options) {
  if (!(this instanceof Scaler)) return new Scaler(redis, options);

  options = options || {};

  //
  // The HTTP routes that we should be listening on.
  //
  this.broadcast = options.broadcast || '/stream/broadcast';
  this.endpoint = options.endpoint || '/stream/';

  // The redis client we need to keep connection state.
  this.redis = redis || require('redis').createClient();

  // The root domain of the service, will be used for redirects.
  this.service = options.service || false;

  // The namespace for the keys that are stored in redis.
  this.namespace = options.namespace || 'scaler';

  // How long do we maintain state from a single user (in seconds).
  this.timeout = options.timeout || 60 * 15;

  // The network address this server is approachable on for internal HTTP requests.
  this.networkaddress = options.address || 'localhost';

  // The port number that we should use to connect with this server.
  this.port = options.port || null;

  //
  // Allow custom encoders and decoders, we default to JSON.parse so it should
  // have simular interfaces.
  //
  this.encode = options.encode || JSON.stringify;
  this.decode = options.decode || JSON.parse;

  //
  // These properies will be set once we're initialized.
  //
  this.server = null;         // HTTP server instance.
  this.engine = null;         // Engine.IO server.

  //
  // Stores `sockets` by created session ids.
  //
  this.sockets = Object.create(null);
};

//
// The scaler inherits from the EventEmitter so we can savely emit events
// without creating tail recursion.
//
Scaler.prototype.__proto__ = require('events').EventEmitter.prototype;

//
// Because we are to lazy to combine address + port every single time.
//
Object.defineProperty(Scaler.prototype, 'uri', {
  get: function get() {
    return 'http://'+ [this.networkaddress, this.port].filter(Boolean).join(':');
  }
});

//
// Expose the version number.
//
Scaler.prototype.version = require('./package.json').version;

/**
 * Add a new custom session id generator.
 *
 * @api public
 */
Scaler.prototype.uuid = function uuid(generator) {
  this.generator = generator;
  return this;
};

/**
 * A simple persistent session generator.
 *
 * @param {Socket} socket Engine.IO socket
 * @param {Function} fn Callback
 * @api private
 */
Scaler.prototype.generator = function generator(socket, fn) {
  fn(undefined, [1, 1, 1, 1].map(function generator() {
    return Math.random().toString(36).substring(2).toUpperCase();
  }).join('-'));
};

/**
 * Simple Engine.io onOpen method handler so we can add data to the handshake.
 *
 * @see 3rd-Eden/engine.io/commit/627fa5b4e794a5c624447bde34ce8ef284a6ba00
 * @param {Socket} socket Engine.IO socket
 * @param {Function} fn Callback.
 * @api private
 */
Scaler.prototype.initialise = function initialise(socket, fn) {
  var scaler = this;

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
      scaler.generator.bind(this, socket),

      //
      // 2: Add the session, account and id so we can find this user back.
      //
      function connect(data, next) {
        var account = socket.request.query.account;

        //
        // Store the session in the query parameters.
        //
        socket.request.query.session = data;

        scaler.connect(account, data, socket.id, function (err, members) {
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
 * @param {Boolean} websocket This is a WebSocket request
 * @param {Request} req HTTP request instance.
 * @param {Response} res HTTP response instance.
 * @param {Buffer} head HTTP head buffer.
 * @api private
 */
Scaler.prototype.intercept = function intercept(websocket, req, res, head) {
  req.uri = req.uri || parser(req.url, true);
  req.query = req.query || req.uri.query;

  if (
       this.engine
    && this.endpoint === req.uri.pathname
    && 'account' in req.query
  ) {
    if (websocket) return this.engine.handleUpgrade(req, res, head);
    return this.engine.handleRequest(req, res);
  } else if (websocket) {
    //
    // We cannot do fancy pancy redirection for WebSocket calls. So instead we
    // should just close the connecting socket.
    //
    return res.end();
  }

  if (
       'put' === (req.method || '').toLowerCase()
    && this.broadcast === req.uri.pathname
  ) {
    //
    // Add some identifying headers.
    //
    res.setHeader('X-Powered-By', 'Scaler/v'+ this.version);
    return this.incoming(req, res);
  }

  //
  // This is an unknown request, let's just assume that this user is just
  // exploring our server with the best intentions and redirect him to the
  // service domain.
  //
  if (this.service) {
    res.statusCode = 301;
    res.setHeader('Location', this.service);
    return res.end('');
  }

  //
  // Well, fuck it, keeel it, with fire!
  //
  this.end('bad request', res);
};

/**
 * Set the network address where this server is accessible on.
 *
 * @param {String} address Network address
 * @param {String} port The port number
 * @api public
 */
Scaler.prototype.network = function network(address, port) {
  if (address) this.networkaddress = address;
  if (port) this.port = port;

  return this;
};

/**
 * Find the socket by session id.
 *
 * @param {String} session The session id we want to find.
 * @returns {Socket} The matching engine.io socket
 * @api private
 */
Scaler.prototype.socket = function socket(session) {
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
Scaler.prototype.connect = function connect(account, session, id, fn) {
  var key = this.namespace +'::'+ account +'::'+ session
    , value = this.uri +'@'+ id
    , scaler = this;

  this.redis.multi()
    .setex(key, this.timeout, value)    // Save our update location.
    .smembers(key +'::pipe')            // Retrieve all users that are listening.
  .exec(function setx(err, replies) {
    var data;

    //
    // We need to "parse" the replies to determin if we actually received an
    // error. Because this fucking pieces of shitty `node-redis` library doesn't
    // correctly parse error responses for MULTI/EXEC calls.
    //
    replies.some(function some(reply) {
      if (!err && ~reply.indexOf('ERR'))  err = new Error(reply);

      return !!err;
    });

    if (fn) fn.call(this, err, replies[1]);
    if (err) return scaler.emit('error::connect', err, {
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
 */
Scaler.prototype.disconnect = function disconnect(account, session, id, fn) {
  var key = this.namespace +'::'+ account +'::'+ session
    , value = this.uri +'@'+ id
    , scaler = this;

  this.redis.del(key, function del(err) {
    if (fn) fn.apply(this, arguments);
    if (err) return scaler.emit('error::disconnect', err, {
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
Scaler.prototype.find = function find(account, session, fn) {
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
Scaler.prototype.forward = function forward(account, session, message, fn) {
  var scaler = this;

  return this.find(account, session, function found(err, server, id) {
    if (err || !server) return fn(err || new Error('Unknown session id '+ session));

    scaler.communicate(server, id, message, fn);
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
Scaler.prototype.communicate = function communicate(server, id, message, fn) {
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
    // a statusCode 200 from the targetted server.
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
 * @param {Socket} socket The Engine.IO socket that want's to follow a user.
 * @param {String} account Account id.
 * @param {String} session Session id.
 * @param {Function} fn Callback.
 * @api public
 */
Scaler.prototype.pipe = function pipe(socket, account, session, fn) {
  fn = fn || noop;

  if (account !== socket.request.query.account) {
    return fn(new Error('Cannot follow other accounts'));
  }

  var key = this.namespace +'::'+ account +'::'+ session +'::pipe'
    , value = this.uri +'@'+ socket.id
    , scaler = this;

  this.redis.sadd(key, value, function follow(err) {
    if (err) return fn(err);

    scaler.forward(account, session, [ value ], fn);
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
Scaler.prototype.incoming = function incoming(req, res) {
  var scaler = this
    , buff = '';

  //
  // Receive the data from the socket. the setEncoding ensures that unicode
  // chars are correctly buffered and parsed before the `data` event is emitted.
  //
  req.setEncoding('utf8');
  req.on('data', function data(chunk) { buff += chunk; });
  req.once('end', function end() {
    var data;

    try { data = scaler.decode(buff); }
    catch (e) {
      scaler.end('broken', res);
      return scaler.emit('error::invalid', e, {
        raw: buff,
        request: req
      });
    }

    if (
        typeof data !== 'object'                // Message should be an object.
      || Array.isArray(data)                    // Not an array..
      || !('message' in data && 'id' in data)   // And have the required fields.
    ) {
      scaler.end('invalid', res);
      return scaler.emit('error::invalid', new Error('Invalid packet received'), {
        raw: buff,
        request: req
      });
    }

    //
    // Try to find the connected socket on our server.
    //
    if (!(data.id in scaler.engine.clients)) {
      return scaler.end('unknown socket', res);
    }

    //
    // Write the message to the client.
    //
    var socket = scaler.engine.clients[data.id];

    //
    // Determin how we should handle this message.
    //
    switch (toString.call(data.message).slice(8, -1)) {
      case 'String':
        socket.emit('scaler::pipe', data.message);
      break;

      case 'Array':
        socket.emit('scaler::tail', data.message);
      break;

      default:
        socket.emit('scaler', data.message);
    }

    scaler.end('sending', res);
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
Scaler.prototype.validate = function validate(event, validator) {
  var callbackargument = validator.length - 1
    , scaler = this;

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

        return scaler.emit('error::validation', err, {
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

      scaler.emit.apply(scaler, data);

      //
      // Now that everything is validated, we are going to check if we have any
      // socket tail's who want to receive this data.
      //
      if (!scaler.engine || !(user.id in scaler.engine.clients)) return;
      var socket = scaler.engine.clients[user.id];

      socket.tail.forEach(function tail(gator) {
        if (!gator) return;

        var data = gator.split('@');
        scaler.communicate(data[0], data[1], raw, noop);
      });
    };

    validator.apply(this, data);
  });
};

/**
 * A new Engine.IO request has been received.
 *
 * @param {Socket} socket Engine.io socket
 * @api private
 */
Scaler.prototype.connection = function connection(socket) {
  var session = socket.request.query.session
    , account = socket.request.query.account
    , id = socket.id
    , scaler = this
    , user;

  //
  // A simple user packet that would give un enough information on who the fuck
  // the user is.
  //
  user = new User(account, session, id);

  //
  // Store a reference for the socket.
  //
  this.sockets[session] = socket;

  //
  // Parse messages.
  //
  socket.on('message', function preparser(raw) {
    var data, emitted;

    try { data = scaler.decode(raw); }
    catch (e) {
      return scaler.emit('error::invalid', e, {
        raw: raw,
        user: user
      });
    }

    //
    // The received data should be either be an Object or Array, JSON does
    // support strings and numbers but we don't want those :).
    //
    if ('object' !== typeof data) {
      return scaler.emit('error::invalid', new Error('Not an object'), {
        raw: raw,
        user: user
      });
    }

    //
    // Check if the message was formatted as an event, if it is we need to
    // prefix it with `stream:` to namespace the event and prevent collitions
    // with other internal events. And this also ensures that we will not
    // override existing Engine.IO events and cause loops when an attacker
    // emits an `message` event.
    //
    if (data && 'object' === typeof data && 'event' in data) {
      data.args.unshift('validate::'+ data.event);
      data.args.push(user);
      data.args.push(raw);

      if (!scaler.emit.apply(scaler, data.args)) {
        scaler.emit('error::validation', new Error('Validator missing'), {
          event: data.event,
          raw: raw,
          user: user
        });
      }
    } else if (!scaler.emit('validate::message', data, user, raw)) {
      scaler.emit('error::validation', new Error('Validator missing'), {
        event: 'message',
        raw: raw,
        user: user
      });
    }
  });

  //
  // Listen for external requests.
  //
  socket.on('scaler::pipe', function pipe(data) {
    if ('string' !== typeof data) data = scaler.encode(data);

    socket.write(data);
  });

  //
  // Listen for new followers
  //
  socket.on('scaler::tail', function tail(members) {
    members.forEach(function follower(member) {
      if (~socket.tail.indexOf(member)) return;

      socket.tail.push(member);
    });
  });

  //
  // Clean up the socket connection. Remove all listeners.
  //
  socket.once('close', function disconnect() {
    scaler.disconnect(account, session, id);
    delete scaler.sockets[session];
    socket.removeAllListeners();
  });
};

/**
 * Proxy events from Engine.IO or the HTTP server directly to our Scaler
 * instance. This is done without throwing errors because we check beforehand if
 * there are listeners attached for the given event before we emit it.
 *
 * @param {String} event Name of the event we are emitting.
 * @api private
 */
Scaler.prototype.proxy = function proxy(event) {
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
Scaler.prototype.end = function end(type, res) {
  var compiled = Scaler.prototype.end
    , msg = compiled[type] || compiled['bad request'];

  if (!res) return msg;

  res.statusCode = msg.json.status || 400;
  res.setHeader('Content-Type', 'application/json');
  res.end(msg);

  return msg;
};

//
// Generate the default responses.
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
    description: 'The requested socket was not found.'
  },
  {
    status: 200,
    type: 'sending',
    description: 'Sending the message to the socket'
  }
].forEach(function precompile(document) {
  Scaler.prototype.end[document.type] = new Buffer(JSON.stringify(document));
  Scaler.prototype.end[document.type].json = document;
});

/**
 * Destroy the scaler server and clean up all it's references.
 *
 * @api public
 */
Scaler.prototype.destroy = function destroy(fn) {
  var scaler = this;

  this.server.removeAllListeners('request');
  this.engine.removeAllListeners('connection');
  this.server.close(function closed() {
    scaler.redis.end();
    scaler.server.removeAllListeners('error');

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
Scaler.prototype.listen = function listen() {
  var args = slice.call(arguments, 0)
    , port = +args[0];

  //
  // Setup the real-time engine.
  //
  this.engine = new Engine();
  this.engine.onOpen = this.initialise.bind(this);
  this.engine.on('connection', this.connection.bind(this));

  //
  // Create the HTTP server.
  //
  if (port) this.port = port;
  this.server = require('http').createServer();
  this.server.on('request', this.intercept.bind(this, false));
  this.server.on('upgrade', this.intercept.bind(this, true));

  this.server.on('listening', this.proxy.bind(this, 'listening'));
  this.server.on('error', this.proxy.bind(this, 'error'));
  this.server.on('close', this.proxy.bind(this, 'close'));

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
  Scaler.prototype[method] = function proxy() {
    this.server[method].apply(this.server, arguments);
    return this;
  };
});

/**
 * Create a new server.
 *
 * @param {
 * @api public
 */
Scaler.createServer = function createServer(redis, options) {
  return new Scaler(redis, options);
};

//
// Expose the User object.
//
Scaler.User = User;

//
// !!! IMPORTANT !!!
// Some extensions to the Engine.IO Socket that would make it easier to
// communicate with the connected clients.
// !!! IMPORTANT !!!
//

/**
 * Stores a list of connections that tailing our every message.
 *
 * @type {Array}
 * @private
 */
Socket.prototype.tail = [];

/**
 * Emit an event.
 *
 * @param {String} name The event name.
 * @api public
 */
Socket.prototype.event = function event(name) {
  this.write(this.encode({
    event: event,
    args: slice.call(arguments, 1)
  }));
};
