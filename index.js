'use strict';

var Engine = require('engine.io').Server
  , Socket = require('engine.io').Socket
  , parser = require('url').parse
  , request = require('request')
  , Route = require('routable');

//
// Cached prototypes to speed up lookups.
//
var toString = Object.prototype.toString
  , slice = Array.prototype.slice;

/**
 * Create a new Scaler instance.
 *
 * @constructor
 * @param {Redis} redis A Redis client.
 * @param {Object} options Scaler options.
 * @api public
 */
function Scaler(redis, options) {
  options = options || {};

  //
  // The HTTP routes that we should be listening on.
  //
  this.broadcast = new Route(options.broadcast || '/scaler/broadcast');
  this.endpoint = new Route(options.endpoint || /\/stream\/(.*)?/);

  // The redis client we need to keep connection state.
  this.redis = redis || require('redis').createClient();

  // The root domain of the service, will be used for redirects.
  this.service = options.service || false;

  // The namespace for the keys that are stored in redis.
  this.namespace = options.namespace || 'scaler';

  // How long do we maintain state from a single user (in seconds).
  this.timeout = options.timeout || 60 * 15;

  // The network address this server is approachable on for internal HTTP requests.
  this.address = options.address || 'localhost';

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
}

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
    return 'http://'+ [this.address, this.port].filter(Boolean).join(':');
  }
});

//
// Expose the version number.
//
Scaler.prototype.version = require('./package.json').version;

/**
 * Add a new custom session id generator.
 *
 * @param {Function} generator The UUID generator.
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
  process.nextTick(function () {
    scaler.generator(socket, function generated(err, session) {
      if (err) return fn(err);

      var account = socket.request.query.account
        , id = socket.id;

      //
      // Store the session in the query parameters.
      //
      socket.request.query.session = session;
      scaler.connect(account, session, function connect() {
        fn(undefined, { session: session, account: account });
      });
    });
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
  req.query = req.query || parser(req.url, true).query;

  if (
       this.engine
    && this.endpoint.test(req.url)
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

  //
  // Add some identifying headers.
  //
  res.setHeader('X-Powered-By', 'Scaler/v'+ this.version);

  if (
       'put' === (req.method || '').toLowerCase()
    && this.broadcast.test(req.url)
  ) {
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
  if (address) this.address = address;
  if (port) this.port = port;

  return this;
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

  this.redis.setex(key, this.timeout, value, function setx(err) {
    if (fn) fn.apply(this, arguments);
    if (err) return scaler.emit('error::connect', err, key, value);
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
    if (err) return scaler.emit('error::disconnect', err, key, value);
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
  this.find(account, session, function found(err, server, id) {
    if (err || !server) return fn(err || new Error('Unknown session id '+ session));

    request({
      uri: server + exports.endpoint,
      method: 'PUT',
      json: {
        id: id,           // The id of the socket that should receive the data.
        message: message  // The actual message.
      }
    }, function requested(err, response, body) {
      var status = response.statusCode;

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
  });

  return this;
};

/**
 * An other server wants to send something one of our connected sockets.
 *
 * @param {Request} req
 * @param {Respone} res
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
      return scaler.emit('error::invalid', e, buff);
    }

    if (
        typeof data !== 'object'                // Message should be an object.
      || Array.isArray(data)                    // Not an array..
      || !('message' in data && 'id' in data)   // And have the required fields.
    ) {
      scaler.end('invalid', res);
      return scaler.emit('error::invalid', new Error('Invalid packet received'), buff);
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

      case 'Object':
        socket.emit('scaler::follow', data.message);
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
  var scaler = this;

  this.on('validate::'+ event, function validating() {
    var data = slice.call(arguments, 0);

    data.push(function callback(err, ok, tranformed) {
      if (err) return scaler.emit('error::validation', event, err);

      //
      // Only emit an validation error when ok is set to false.
      //
      if (ok === false) {
        return scaler.emit('error::validation', event, new Error('Failed to validate the data'));
      }

      //
      // Emit the event as it's validated, but remove the old callback first.
      //
      data.unshift('stream::'+ event);
      data.pop();

      scaler.emit.apply(scaler, data);
    });

    validator.apply(this, data);
  });

  return this;
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
    , scaler = this;

  //
  // Create a simple user packet that contains all information about this
  // connection.
  //
  var user = Object.create(null);

  user.session = session;
  user.account = account;
  user.id = id;

  //
  // Parse messages.
  //
  socket.on('message', function preparser(message) {
    var data;

    try { data = scaler.decode(message); }
    catch (e) { return scaler.emit('error::json', message); }

    //
    // The received data should be either be an Object or Array, JSON does
    // support strings and numbers but we don't want those :).
    //
    if ('object' !== typeof data) return scaler.emit('error::invalid', message);

    //
    // Check if the message was formatted as an event, if it is we need to
    // prefix it with `stream:` to namespace the event and prevent collitions
    // with other internal events. And this also ensures that we will not
    // override existing Engine.IO events and cause loops when an attacker
    // emits an `message` event.
    //
    if (data && 'object' === typeof data && 'event' in data) {
      data.args.unshift('validate::'+ data.event);
      if (!scaler.emit.apply(scaler, data.args)) {
        scaler.emit('error::validation', data.event, new Error('No validator'));
      }
    } else if (!scaler.emit('validate::message', data || message)) {
      scaler.emit('error::validation', data.event, new Error('No validator'));
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
  // Clean up the socket connection. Remove all listeners.
  //
  socket.once('close', function disconnect() {
    scaler.disconnect(account, session, id);
    socket.removeAllListeners();
    user = null;
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

    (fn || function noop(){}).apply(this, arguments);
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

  this.server.on('listening', this.proxy.bind(this, 'close'));
  this.server.on('error', this.proxy.bind(this, 'error'));
  this.server.on('close', this.proxy.bind(this, 'close'));

  //
  // Proxy all arguments to the server.
  //
  this.server.listen.apply(this.server, args);

  return this;
};

//
// Expose the module's interface.
//
module.exports = Scaler;
