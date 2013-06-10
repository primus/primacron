describe('scaler', function () {
  'use strict';

  var redis = require('redis')
    , Scaler = require('../')
    , chai = require('chai')
    , expect = chai.expect;

  it('requires and creates its own redis client if none is provided', function () {
    var reds = redis.createClient()
      , scale = new Scaler(reds);

    // should set the same client
    expect(scale.redis).to.equal(reds);

    scale = new Scaler();
    expect(scale.redis).to.not.equal(reds);
    expect(scale.redis).to.be.instanceOf(redis.RedisClient);
  });

  it('applies the configuration options');
  it('is an EventEmitter', function () {
    var scale = new Scaler();

    expect(scale).to.be.instanceOf(require('events').EventEmitter);
  });

  describe('#intercept', function () {
    it('closes WebSockets on disallowed ports');
    it('accepts WebSockets on allowed ports');
    it('intercepts PUT requests');
    it('redirects to the given service');
    it('closes with a 400 JSON packet');
  });

  describe('#network', function () {
    it('sets the address');
    it('sets the port');
  });

  describe('#connect', function () {
    it('adds a new connection under the namespace');
    it('sets a expiree on the connection');
    it('emits error::connect on failures');
    it('stores host + socket id');
  });

  describe('#disconnect', function () {
    it('removes the connection from redis');
    it('emits the error::disconnect event');
  });

  describe('#find', function () {
    it('finds receives the server and socket id');
  });

  describe('#broadcast', function () {
    it('does a PUT request to the server that belongs to the socket.id');
    it('returns an Error object when a non 200 response is received');
    it('receives a JSON response body');
  });

  describe('#incoming', function () {
    it('receives unicode correctly');
    it('emits error::invalid on parse error');
    it('writes a broken response on parse error');
    it('emits error::invalid on invalid objects');
    it('writes a invalid response on invalid objects');
    it('returns a 404 when the socket cannot be found');
    it('returns a 200 sending when we write to the socket');
  });

  describe('#validate', function () {
    it('calls the provided validated function on the validate:: namespace', function (done) {
      var scale = new Scaler();

      scale.validate('foo', function validate(data, cb) {
        expect(data).to.equal('meh');
        expect(cb).to.be.a('function');

        done();
      }).once('stream::foo', function () {
        throw new Error('Broken');
      });

      scale.emit('validate::foo', 'meh');
    });

    it('emits error::validation when an error occures', function (done) {
      var scale = new Scaler();

      scale.validate('foo', function validate(data, cb) {
        expect(data).to.equal('meh');
        expect(cb).to.be.a('function');

        cb(undefined, false);
      });

      scale.once('error::validation', function validate(event, err) {
        expect(event).to.equal('foo');
        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.equal('Failed to validate the data');

        done();
      }).once('stream::foo', function () {
        throw new Error('Broken');
      });

      scale.emit('validate::foo', 'meh');
    });

    it('emits error::validation when the validation fails', function (done) {
      var scale = new Scaler();

      scale.validate('foo', function validate(data, cb) {
        expect(data).to.equal('meh');
        expect(cb).to.be.a('function');

        cb(new Error('Failed to validate'));
      });

      scale.once('error::validation', function validate(event, err) {
        expect(event).to.equal('foo');
        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.equal('Failed to validate');

        done();
      }).once('stream::foo', function () {
        throw new Error('Broken');
      });

      scale.emit('validate::foo', 'meh');
    });

    it('calls stream:: event once the event was validated successfully', function (done) {
      var scale = new Scaler();

      scale.validate('foo', function validate(data, cb) {
        expect(data).to.equal('meh');
        expect(cb).to.be.a('function');

        cb();
      }).once('stream::foo', function (data) {
        expect(data).to.equal('meh');
        expect(arguments.length).to.equal(1);
        done();
      });

      scale.emit('validate::foo', 'meh');
    });
  });

  describe('#connection', function () {
    it('connects the socket');
    it('parses all received messages');
    it('emits an error::json on invalid json');
    it('emits an error::invalid on a invalid message');
    it('parses event messages');
  });

  describe('#end', function () {
    it('returns a buffer');
    it('returns a buffer that belongs to the given type');
    it('responds to the res with the given type');
  });

  describe('#destroy', function () {
    it('removes all event listeners');
    it('closes the server');
  });

  describe('#listen', function () {
    it('starts the Engine.IO server');
    it('attaches event listeners');
    it('proxies the events to the server#listen method');
  });
});
