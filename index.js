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
  server = this.createServer(server);

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
 * Create a HTTP server for the given options.
 *
 * @type {Function}
 * @api private
 */
Primacron.readable('createServer', require('create-server'));

//
// Expose the Server
//
module.exports = Primacron;
