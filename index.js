'use strict';

var Engine = require('engine.io').Server
  , Socket = require('engine.io').Socket
  , request = require('request')
  , Route = require('routable');

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
  this.endpoint = new Route(options.endpoint || '/stream/');

  // The redis client we need to keep connection state.
  this.redis = redis || require('redis').createClient();

  // The root domain of the service, will be used for redirects.
  this.service = options.service || false;

  // The namespace for the keys that are stored in redis.
  this.namespace = options.namespace || 'scaler';

  // How long do we maintain stake from a single user.
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
Object.defineProperty(Scaler.prototype, 'interface', {
  get: function get() {
    return this.address +':'+ this.port;
  }
});

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
  if (this.engine && this.endpoint.test(req.url)) {
    if (websocket) return this.engine.handleUpgrade(req, res, head);
    return this.engine.handleRequest(req, res);
  } else if (websocket) {
    //
    // We cannot do fancy pancy redirection for WebSocket calls. So instead we
    // should just close the connecting socket.
    //
    return res.end();
  }

  if ('put' === req.method && this.broadcast.test(req.url)) {
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
 * @param {String} id Connection id
 * @api private
 */
Scaler.prototype.connect = function connect(account, session, id) {
  var key = this.namespace +'::'+ account +'::'+ session
    , value = this.interface +'@'+ id
    , scaler = this;

  this.redis.setx(key, this.timeout, value, function setx(err) {
    if (err) return scaler.emit('error::connect', key, value);
  });

  return this;
};

/**
 * Remove a connection.
 *
 * @param {String} account Account id.
 * @param {String} session Session id.
 * @param {String} id Connection id
 */
Scaler.prototype.disconnect = function disconnect(account, session, id) {
  var key = this.namespace +'::'+ account +'::'+ session
    , value = this.interface +'@'+ id
    , scaler = this;

  this.redis.del(key, function del(err) {
    if (err) return scaler.emit('error::disconnect', key, value);
  });

  return this;
};

/**
 * Find a server for a given session id.
 *
 * @param {String} account Observe.it account id.
 * @param {String} session Session id of the user.
 * @param {Function} fn Callback
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
 * @param {String} message Message
 * @param {Function} fn Callback
 * @api public
 */
Scaler.prototype.broadcast = function broadcast(account, session, message, fn) {
  this.find(account, session, function found(err, server, id) {
    if (err || !server) return fn(err || new Error('Unknown session id '+ session));

    request({
      uri: 'http://'+ server + exports.endpoint,
      method: 'PUT',
      json: {
        id: id,           // The id of the socket that should receive the data.
        message: message  // The actual message.
      }
    }, function requested(err, response, body) {
      var status = response.statusCode;

      if (err || status !== 200) {
        return fn(err || new Error('Invalid status code ('+ status +') returned'));
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
  res.setEncoding('utf8');
  req.on('data', function data(chunk) { buff += chunk; });
  req.once('end', function end() {
    var data;

    try { data = scaler.decode(buff); }
    catch (e) {
      scaler.end('broken', res);
      return scaler.emit('error::invalid', buff);
    }

    if (
        typeof data !== 'object'                // Message should be an object
      || Array.isArray(data)                    // Not an array..
      || !('message' in data && 'id' in data)   // And have the required fields
    ) {
      scaler.end('invalid', res);
      return scaler.emit('error::invalid', buff);
    }

    //
    // Try to find the connected socket on our server.
    //
    if (!(data.id in scaler.engine.clients)) {
      return scaler.end('unkown socket', res);
    }

    //
    // Write the message to the client.
    //
    scaler.end('ending', res);
    scaler.engine.clients[data.id].emit('scaler', data.message);
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

  this.on('validate::', function validating() {
    var data = Array.prototype.slice.call(arguments, 0);

    data.push(function callback(err, ok) {
      if (err) return scaler.emit('error::validation', event, err);
      if (!ok) return scaler.emit('error::validation', event, new Error('Invalid'));

      //
      // Emit the event as it's validated.
      //
      data.unshift('stream::'+ event);
      scaler.emit.apply(scaler, data);
    });
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
  // connection
  //
  var user = Object.create(null);

  user.session = session;
  user.account = account;
  user.id = id;

  scaler.connect(account, session, id);

  //
  // Parse messages.
  //
  socket.on('message', function preparser(message) {
    var data;

    try { data = scaler.decode(message); }
    catch (e) { return scaler.emit('error::json', message); }

    //
    // The received data should be either be an Object or Array, JSON does
    // support strings and numbers but we don't want those :)
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
  // Clean up the socket connection. Remove all listeners.
  //
  socket.once('close', function disconnect() {
    scaler.disconnect(account, session, id);
    socket.removeAllListeners();
    user = null;
  });
};

/**
 * Return a default response for the given request.
 *
 * @param {String} type The name of the response we should send.
 * @param {Response} res HTTP response object
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
    type: 'invalid',
    description: 'Received an invalid JSON document.'
  },
  {
    status: 404,
    type: 'unkown socket',
    description: 'The requested socket was found.'
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
  this.server.close(fn);

  this.server.removeAllListeners('request');
  this.server.removeAllListeners('upgrade');
  this.engine.removeAllListeners('connection');

  return this;
};

/**
 * This argument accepts what ever you want to send to a regular server.listen
 * method.
 *
 * @api public
 */
Scaler.prototype.listen = function listen() {
  var args = Array.prototype.slice.call(arguments, 0)
    , port = args[0];

  //
  // Setup the real-time engine.
  //
  this.engine = new Engine();
  this.engine.on('connection', this.connection.bind(this));

  //
  // Create the HTTP server.
  //
  this.port = port;
  this.server = require('http').createServer();
  this.server.on('request', this.intercept.bind(this, 'http'));
  this.server.on('upgrade', this.intercept.bind(this, 'websocket'));

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
