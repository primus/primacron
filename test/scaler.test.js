describe('scaler', function () {
  'use strict';

  var eio = require('engine.io-client')
    , request = require('request')
    , redis = require('redis')
    , Scaler = require('../')
    , chai = require('chai')
    , expect = chai.expect
    , portnumbers = 1024
    , server
    , reds;

  //
  // Include a stacktrace.
  //
  chai.Assertion.includeStack = true;

  beforeEach(function beforeEach(done) {
    server = new Scaler();
    server.listen(++portnumbers, done);
  });

  afterEach(function afterEach(done) {
    server.destroy(done);
  });

  it('requires and creates its own redis client if none is provided', function () {
    var reds = redis.createClient()
      , scale = new Scaler(reds);

    // should set the same client
    expect(scale.redis).to.equal(reds);

    scale = new Scaler();
    expect(scale.redis).to.not.equal(reds);
    expect(scale.redis).to.be.instanceOf(redis.RedisClient);
  });

  it('applies the configuration options', function () {
    var scale = new Scaler(null, {
      broadcast: '/foo/broadcast',
      endpoint: '/foo/endpoint',
      service: 'http://google.com',
      namespace: 'cows'
    });

    expect(scale.broadcast.toString()).to.equal('/foo/broadcast');
    expect(scale.endpoint.toString()).to.equal('/foo/endpoint');
    expect(scale.broadcast).to.be.instanceOf(require('routable'));
    expect(scale.endpoint).to.be.instanceOf(require('routable'));
    expect(scale.service).to.equal('http://google.com');
    expect(scale.namespace).to.equal('cows');
  });

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
    it('sets the address', function () {
      var scale = new Scaler();

      expect(scale.address).to.equal('localhost');
      expect(scale.port).to.equal(null);

      scale.network('127.0.0.1');

      expect(scale.address).to.equal('127.0.0.1');
      expect(scale.port).to.equal(null);
    });

    it('sets the port', function () {
      var scale = new Scaler();

      expect(scale.address).to.equal('localhost');
      expect(scale.port).to.equal(null);

      scale.network('127.0.0.1', 2456);

      expect(scale.address).to.equal('127.0.0.1');
      expect(scale.port).to.equal(2456);
    });

    it('updates the values for the uri property', function () {
      var scale = new Scaler();

      expect(scale.uri).to.equal('http://localhost');

      scale.network('127.0.0.1');
      expect(scale.uri).to.equal('http://127.0.0.1');

      scale.network('internal.dns', 1337);
      expect(scale.uri).to.equal('http://internal.dns:1337');
    });
  });

  describe('#connect', function () {
    it('adds a new connection under the namespace', function (done) {
      var scale = new Scaler(null, { namespace: 'ns' });

      scale.connect('foo', 'bar', 'baz', function (err) {
        if (err) return done(err);

        scale.redis.get('ns::foo::bar', function (err, value) {
          if (err) return done(err);

          expect(value).to.equal('http://localhost@baz');
          done();
        });
      });
    });

    it('sets a expiree on the connection', function (done) {
      var scale = new Scaler(null, { namespace: 'ns2', timeout: 1 });

      scale.connect('foo', 'bar', 'baz', function (err) {
        if (err) return done(err);

        scale.redis.get('ns2::foo::bar', function (err, value) {
          if (err) return done(err);

          expect(value).to.equal('http://localhost@baz');

          setTimeout(function timeout() {
            scale.redis.get('ns2::foo::bar', function (err, value) {
              if (err) return done(err);

              expect(!value).to.equal(true);
              done();
            });
          }, 1000);
        });
      });
    });

    it('emits error::connect on failures', function (done) {
      var scale = new Scaler(null , { namespace: 'ff', timeout: 'this should fail' });

      scale.connect('foo', 'bar', 'banana');

      scale.on('error::connect', function error(err, key, value) {
        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.contain('integer');
        expect(key).to.equal('ff::foo::bar');
        expect(value).to.equal('http://localhost@banana');

        done();
      });
    });
  });

  describe('#disconnect', function () {
    it('removes the connection from redis', function (done) {
      var scale = new Scaler(null, { namespace: 'bar' });

      scale.connect('meh', 'bleh', 'spam', function (err) {
        if (err) return done(err);

        scale.disconnect('meh', 'bleh', 'spam', function (err) {
          if (err) return done(err);

          scale.redis.get('bar::meh::bleh', function (err, data) {
            if (err) return done(err);

            expect(!data).to.equal(true);
            done();
          });
        });
      });
    });

    it('emits the error::disconnect event');
  });

  describe('#find', function () {
    it('finds receives the server and socket id', function (done) {
      var scale = new Scaler();

      scale.connect('foo', 'bar', 'banana', function () {
        scale.find('foo', 'bar', function (err, server, socket) {
          if (err) return done(err);

          expect(server).to.equal('http://localhost');
          expect(socket).to.equal('banana');
          done();
        });
      });
    });

    it('doesnt find anything', function (done) {
      var scale = new Scaler();

      scale.find('yo', 'momma', function (err, server, socket) {
        if (err) return done(err);

        expect(!server).to.equal(true);
        expect(!socket).to.equal(true);

        done();
      });
    });
  });

  describe('#forward', function () {
    it('does a PUT request to the server that belongs to the socket.id');
    it('returns an Error object when a non 200 response is received');
    it('receives a JSON response body');
    it('triggers a scaler event');
  });

  describe('#incoming', function () {
    it('receives unicode correctly');

    it('emits error::invalid on parse error', function (done) {
      server.once('error::invalid', function (err, message) {
        expect(err).to.be.instanceOf(Error);

        expect(message).to.be.a('string');
        expect(message).to.equal('{json:foo}');

        done();
      });

      request({
        uri: server.uri + server.broadcast,
        body: '{json:foo}',
        method: 'put'
      }, function (err, res, body) {
        if (err) return done(err);
        body = JSON.parse(body);

        expect(res.statusCode).to.equal(400);
        expect(body).to.be.a('object');
        expect(body.status).to.equal(res.statusCode);
        expect(body.description).to.include('incorrect');
      });
    });

    it('emits error::invalid on invalid objects', function (done) {
      (function iterator(items) {
        var complete = items.length
          , completed = 0;

        function next() {
          var item = items.pop();

          server.once('error::invalid', function (err, message) {
            expect(err).to.be.instanceOf(Error);

            expect(message).to.be.a('string');
            expect(message).to.equal(JSON.stringify(item.json));

            if (++completed === complete) return done();
            next();
          });

          request({
            uri: server.uri + server.broadcast,
            json: item.json,
            method: 'PUT'
          }, function requested(err, res, body) {
            if (err) return done(err);

            expect(res.statusCode).to.equal(400);
            expect(body).to.be.a('object');
            expect(body.status).to.equal(res.statusCode);
            expect(body.description).to.include('invalid');
          });
        }

        next();
      })([
        { json: 1 },
        { json: 'string' },
        { json: ['array', 1] },
        { json: { message: 'message only' }},
        { json: { id: 'id only' }}
      ]);
    });

    it('returns a 404 when the socket cannot be found', function (done) {
      server.once('error::invalid', function (err, message) {
        throw new Error('This message is not fucking invalid, you fucked up');
      });

      request({
        uri: server.uri + server.broadcast,
        json: {
          id: 'foobar',
          message: 'hi'
        },
        method: 'put'
      }, function (err, res, body) {
        if (err) return done(err);

        expect(res.statusCode).to.equal(404);
        expect(body).to.be.a('object');
        expect(body.status).to.equal(res.statusCode);
        expect(body.description).to.include('socket was not found');

        done();
      });
    });

    it('returns a 200 sending when we write to the socket', function (done) {
      var io = eio(server.uri + server.endpoint +'?m&session=9797adf&account=foo', {
        path: '/stream/'
      });

      io.onopen = function onopen() {
        server.forward('foo', io.id, 'foobar', function (err) {
          if (err) return done(err);
        });
      };

      io.onmessage = function onmessage(data) {
        expect(data).to.equal('foobar');
        done();
      };
    });
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
    it('returns a buffer', function () {
      var data = server.end('broken')
        , buffer = Buffer.isBuffer(data);

      expect(buffer).to.equal(true);
    });

    it('returns a buffer that belongs to the given type', function () {
      expect(server.end('broken').toString()).to.include('incorrect');
      expect(server.end('invalid').toString()).to.include('invalid');
      expect(server.end('i dont exist').toString()).to.include('Bad request');
    });

    it('answers the given request object with the correct headers & status');
  });

  describe('#destroy', function () {
    it('removes all event listeners');
    it('closes the server');
  });

  describe('#listen', function () {
    it('starts the Engine.IO server');

    it('saves the port number', function () {
      var address = server.server.address();

      expect(server.port).to.equal(portnumbers);
      expect(server.port).to.equal(address.port);
    });

    it('attaches event listeners');
    it('proxies the events to the server#listen method');
  });
});
