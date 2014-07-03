'use strict';

var EventEmitter = require('events').EventEmitter
  , Primus = require('primus')
  , fuse = require('fusing')
  , path = require('path');

/**
 * Create a new Primacron server.
 *
 * @constructor
 * @param {Server} server HTTP server.
 * @param {Object} options Optional configuration.
 * @api private
 */
function Primacron(server, options) {
  if (!(this instanceof Primacron)) return new Primacron(server, options);

  options = this.configurable(options || server);

  //
  // In Node, all servers inherit from the EventEmitter or net.Server. This is
  // gives us a some what reliable check to see if we need to create a server.
  // By allowing EventEmitters we can also compile client code without creating
  // an actual HTTP server.
  //
  if (!(server instanceof EventEmitter)) {
    server = require('create-server')(server || options);
  }

  var listening = !!server.listeners('listening').length;

  this.fuse([server, options]);

  this.use('fortress maximus', require('fortress-maximus'));
  this.use('omega supreme', require('omega-supreme'));
  this.use('emit', require('primus-emit/broadcast'));
  this.use('metroplex', require('metroplex'));
  this.use('mirage', require('mirage'));

  //
  // If the provided options tell the create-server to automatically start
  // listening on the server we need to automatically call the .listen method so
  // we can assign the correct listeners.
  //
  if (listening) {
    this.listen();
  }
}

fuse(Primacron, Primus);

/**
 * Return a pre-configured configuration for Primus.
 *
 * @param {Object} options Given optional options.
 * @returns {Object} Pre configured objects.
 * @api private
 */
Primacron.readable('configurable', function configurable(options) {
  if ('object' !== typeof options) options = {};

  var pathname = options.pathname || '/primacron';

  return this.merge({
    url: path.resolve(pathname, './omega/supreme'),
    transformer: 'engine.io',
    namespace: 'primacron',
    pathname: pathname,
    fortress: 'primus',
    parser: 'JSON'
  }, options);
});

/**
 * This argument accepts what ever you want to send to a regular server.listen
 * method.
 *
 * @api public
 */
Primacron.readable('listen', function listen() {
  var listening = !!this.server.listeners('listening').length;

  //
  // Proxy the events of the HTTP server to our own Primacron instance.
  //
  this.server.on('listening', this.emits('listening'));
  this.server.on('error', this.emits('error'));
  this.server.on('close', this.emits('close'));

  //
  // Proxy all arguments to the server if we're not already listening
  //
  if (!listening && this.server.listen) {
    this.server.listen.apply(this.server, arguments);
  }
});

//
// Add missing methods of a regular HTTP server that we can proxy from our
// internal `this.server` instance.
//
['address', 'getConnections'].forEach(function missing(method) {
  Primacron.readable(method, function proxy() {
    var res = this.server[method].apply(this.server, arguments);

    //
    // Figure out which kind of value we should return. If this was a chaining
    // method on the server we should just return Primacron instead. If it's not
    // the server that is returned we should return the value.
    //
    if (res === this.server) return this;
    return res;
  });
});

/**
 * Create a client.
 *
 * @returns {Primacron} client
 * @api private
 */
Primacron.client = function client() {
  var primacron = new Primacron(new EventEmitter(), {});

  return primacron.Socket;
};

//
// Expose the Server
//
module.exports = Primacron;
