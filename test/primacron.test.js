describe('Primacron', function () {
  'use strict';

  var Primacron = require('../')
    , assume = require('assume')
    , portnumbers = 1024
    , server;

  beforeEach(function beforeEach(done) {
    server = new Primacron({
      port: ++portnumbers,
      listening: done
    });
  });

  afterEach(function afterEach(done) {
    server.destroy(done);
  });

  describe('#listen', function () {
    it('should register a listening event on the consumed server that re-emits', function (done) {
      var prima = new Primacron({
        port: ++portnumbers,
        listen: false
      });

      prima.on('listening', function () {
        prima.destroy(done);
      });

      prima.listen();
      assume(prima.server._events).to.have.property('listening');
      assume(prima.server._events.listening).to.be.an('array');
      prima.server._events.listening.forEach(function (fn) {
        assume(fn).to.be.a('function');
      });
    });

    it('should register a close event on the consumed server that re-emits', function (done) {
      var prima = new Primacron({
        port: ++portnumbers,
        listen: false
      });

      prima.on('close', function () {
        done(); // cannot be passed directly due to provided options.
      });
      prima.on('listening', function () {
        prima.destroy();
      });

      prima.listen();
      assume(prima.server._events).to.have.property('close');
      assume(prima.server._events.close).to.be.a('function');
    });
  });
});
