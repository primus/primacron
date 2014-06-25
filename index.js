'use strict';

var Primus = require('primus')
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
  server = require('create-server')(this.merge(server, { listen: false }));

  this.fuse([server, options]);

  this.use('fortress maximus', require('fortress-maximus'));
  this.use('omega supreme', require('omega-supreme'));
  this.use('metroplex', require('metroplex'));
  this.use('emit', require('primus-emit'));
  this.use('mirage', require('mirage'));
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

  return this.merge(options, {
    transformer: 'engine.io',   // Engine.IO by default for cross browser support.
    pathname: pathname,         // Use our own pathname.
    parser: 'JSON',             // Default to JSON.

    url: path.resolve(pathname, './omega/supreme'),
    namespace: 'primacron'
  });
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
  this.server.on('listening', this.emits('listening'));
  this.server.on('error', this.emits('error'));
  this.server.on('close', this.emits('close'));

  //
  // Proxy all arguments to the server.
  //
  this.server.listen.apply(this.server, arguments);
});

//
// Add missing methods of a regular HTTP server that we can proxy from our
// internal `this.server` instance.
//
['address'].forEach(function missing(method) {
  Primacron.readable(method, function proxy() {
    this.server[method].apply(this.server, arguments);
    return this;
  });
});

//
// Expose the Server
//
module.exports = Primacron;
