describe('Primacron', function () {
  'use strict';

  var Primacron = require('../')
    , Redis = require('ioredis')
    , assume = require('assume');

  var portnumbers = 1024
    , redis;

  before(function (done) {
    redis = new Redis();
    redis.on('connect', done);
  });

  after(function () {
    return redis.quit();
  });

  afterEach(function () {
    return redis.flushdb();
  });

  describe('#listen', function () {
    it('should register a listening event on the consumed server that re-emits', function (done) {
      var prima = new Primacron({
        port: ++portnumbers,
        listen: false,
        redis
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
        listen: false,
        redis
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
