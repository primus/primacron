'use strict';

//
// !!! IMPORTANT !!!
// Some extensions to the Primus Spark that would make it easier to
// communicate with the connected clients.
// !!! IMPORTANT !!!
//

module.exports = {
  server: function server(primus) {
    var Spark = this.Spark;

    /**
     * Stores a list of connections that tailing our every message.
     *
     * @type {Array}
     * @private
     */
    Spark.prototype.tail = [];

    /**
     * Emit an event.
     *
     * @param {String} name The event name.
     * @api public
     */
    Spark.prototype.event = function event(name) {
      return this.write({
        event: event,
        args: Array.prototype.slice.call(arguments, 1)
      });
    };
  },

  client: function client(primus) {
    /**
     * Emit an event.
     *
     * @param {String} name The event name.
     * @api public
     */
    primus.event = function event(name) {
      return primus.write({
        event: event,
        args: Array.prototype.slice.call(arguments, 1)
      });
    };
  }
};
