'use strict';

var Engine = require('engine.io').Server
  , request = require('request')
  , Route = require('routable');

/**
 * Create a new Scalar instance.
 *
 * @constructor
 * @param {Redis} redis A Redis client.
 * @param {Object} options Scalar options.
 * @api public
 */
function Scalar(redis, options) {
  options = options || {};

  //
  // The HTTP routes that we should be listening on.
  //
  this.broadcast = new Route(options.broadcast || '/scalar/broadcast');
  this.endpoint = new Route(options.endpoint || '/stream/');

  this.redis = redis || require('redis').createClient();
  this.service = options.service || false;
  this.namespace = options.namespace || 'scalar';
  this.timeout = options.timeout || 60 * 15;

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
  this.address = 'localhost'; // Network address were this server is approachable on.
  this.port = null;           // Port number.
}

//
// The scalar inherits from the EventEmitter so we can savely emit events
// without creating tail recursion.
//
Scalar.prototype.__proto__ = require('events').EventEmitter.prototype;

//
// Because we are to lazy to combine address + port every single time.
//
Object.defineProperty(Scalar.prototype, 'interface', {
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
Scalar.prototype.intercept = function intercept(websocket, req, res, head) {
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
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json');
  res.end(this.response('bad request'));
};

/**
 * Set the network address where this server is accessible on.
 *
 * @param {String} address Network address
 * @param {String} port The port number
 * @api public
 */
Scalar.prototype.network = function network(address, port) {
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
Scalar.prototype.connect = function connect(account, session, id) {
  var key = this.namespace +'::'+ account +'::'+ session
    , value = this.interface +'@'+ id
    , scalar = this;

  this.redis.setx(key, this.timeout, value, function setx(err) {
    if (err) return scalar.emit('error::connect', key, id);
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
Scalar.prototype.disconnect = function disconnect(account, session, id) {
  var key = this.namespace +'::'+ account +'::'+ session
    , scalar = this;

  this.redis.del(key, function del(err) {
    if (err) return scalar.emit('error::disconnect', key, id);
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
Scalar.prototype.incoming = function incoming(req, res) {
  return this;
};

/**
 * A new Engine.IO request has been received.
 *
 * @param {Socket} socket Engine.io socket
 * @api private
 */
Scalar.prototype.connection = function connection(socket) {
  var session = socket.request.query.session
    , account = socket.request.query.account
    , id = socket.id;

  this.connect(account, session, id, function connect(err) {

  });
};

/**
 * Return a default response for the given request.
 *
 * @param {String} type The name of the response we should send.
 * @returns {Buffer} Pre compiled response buffer.
 * @api private
 */
Scalar.prototype.response = function response(type) {
  return Scalar.prototype.response[type] || Scalar.prototype.response['bad request'];
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
  Scalar.prototype.response[document.type] = new Buffer(JSON.stringify(document));
});

/**
 * Destroy the scalar server and clean up all it's references.
 *
 * @api public
 */
Scalar.prototype.destroy = function destroy(fn) {
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
Scalar.prototype.listen = function listen() {
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
