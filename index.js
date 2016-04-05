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
    server = require('create-server')(this.merge(server || options, {
      listen: false // Force false by default as WE want to do the listening manually
    }));
  }

  this.fuse([server, options]);

  //
  // The order of middleware usage is important here.
  //
  // 1. Mirage buffers requests if there isn't a valid id or if an id is still
  //    generating so it doesn't process the data without an id.
  // 2. Fortess needs to validate the all incoming messages and should come
  //    before other modules that re-emit.
  // 3. Supreme, doesn't really matter, but it should come before Metroplex.
  // 4. Emit, honey badger don't care.
  // 5. Metroplex, just do cluster management.
  //
  this.use('mirage', require('mirage'));
  this.use('fortress maximus', require('fortress-maximus'));
  this.use('omega supreme', require('omega-supreme'));
  this.use('emit', require('primus-emit/broadcast'));
  this.use('metroplex', require('metroplex'));

  //
  // If the provided options tell the create-server to automatically start
  // listening on the server we need to automatically call the .listen method so
  // we can assign the correct listeners.
  //
  if (false !== this.options.listen) {
    this.listen(this.options.port || 443);
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
    transformer: 'websockets',
    namespace: 'primacron',
    pathname: pathname,
    fortress: 'primus',
    concurrently: 10,
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
  //
  // Proxy the events of the HTTP server to our own Primacron instance.
  //
  this.server.once('listening', this.emits('listening'));
  this.server.on('error', this.emits('error'));

  //
  // Proxy all arguments to the server if we're not already listening
  //
  if (this.server.listen) {
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
