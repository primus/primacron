describe('scaler', function () {
  'use strict';

  var transport = require('engine.io').transports.polling
    , Socket = require('engine.io').Socket
    , eio = require('engine.io-client')
    , request = require('request')
    , redis = require('redis')
    , Scaler = require('../')
    , chai = require('chai')
    , WebSocket = require('ws')
    , expect = chai.expect
    , portnumbers = 1024
    , User = Scaler.User
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
    expect(scale.service).to.equal('http://google.com');
    expect(scale.namespace).to.equal('cows');
  });

  it('is an EventEmitter', function () {
    expect(server).to.be.instanceOf(require('events').EventEmitter);
  });

  it('exposes the version number', function () {
    expect(server.version).to.equal(require('../package.json').version);
  });

  describe('#initialise', function () {
    function transporter() {
      var request = { query: { account: 'foo' }}
        , t = transport(request);

      t.request = request;

      return t;
    }

    it('generates a session', function (done) {
      var socket = new Socket('id', server.engine, transporter());

      server.initialise(socket, function initialise(err, data) {
        if (err) return done(err);

        expect(data).to.be.a('object');
        expect(socket.request.query.account).to.equal(data.account);
        expect(socket.request.query.session).to.equal(data.session);
        expect(socket.tail).to.have.length(0);

        done();
      });
    });

    it('adds tailgators to the socket object', function (done) {
      var socket = new Socket('id', server.engine, transporter())
        , ns = server.namespace +'::foo::sessionid::pipe';

      server.uuid(function uuid(socket, fn) {
        fn(null, 'sessionid');
      });

      server.redis.sadd(ns, server.uri +'@momoa',
        function (err) {
        if (err) return done(err);

        server.initialise(socket, function initialise(err, data) {
          if (err) return done(err);

          expect(data).to.be.a('object');
          expect(socket.request.query.account).to.equal(data.account);
          expect(socket.request.query.session).to.equal(data.session);
          expect(socket.tail).to.have.length(1);
          expect(socket.tail[0]).to.equal(server.uri + '@momoa');

          done();
        });
      });
    });
  });

  describe('#intercept', function () {
    it('closes WebSockets on disallowed paths', function (done) {
      var ws = new WebSocket(server.uri.replace('http', 'ws'));

      ws.on('error', function afa() {
        done();
      });
    });

    it('intercepts PUT requests', function (done) {
      request({
        uri: server.uri + server.broadcast,
        json: {
          id: 'foo',
          message: 'mew'
        },
        method: 'put'
      }, function (err, res, body) {
        if (err) return done(err);

        expect(res.headers).to.have.property('x-powered-by');
        expect(res.headers['x-powered-by']).to.equal('Scaler/v'+ server.version);
        done();
      });
    });

    it('dies put requests on the incorrect paths', function (done) {
      request({
        uri: server.uri +'/cows',
        json: {
          id: 'foo',
          message: 'madfaf'
        },
        method: 'put'
      }, function (err, res, body) {
        if (err) return done(err);

        expect(res.headers).to.not.have.property('x-powered-by');
        done();
      });
    });

    it('redirects to the given service', function (done) {
      var scaler = new Scaler(null, { service: 'http://google.com' });

      scaler.listen(++portnumbers, function () {
        request({
          uri: scaler.uri +'/cows',
          json: {
            id: 'foo',
            message: 'madfaf'
          },
          method: 'post',
          followRedirect: false
        }, function (err, res, body) {
          if (err) return done(err);

          expect(res.statusCode).to.equal(301);
          expect(res.headers.location).to.equal('http://google.com');

          scaler.destroy(done);
        });
      });
    });

    it('closes with a 400 JSON packet', function (done) {
      request({
        uri: server.uri +'/cows',
        json: {
          id: 'foo',
          message: 'madfaf'
        },
        method: 'post'
      }, function (err, res, body) {
        if (err) return done(err);

        expect(res.statusCode).to.equal(400);
        expect(body.description).to.include('Bad request');
        done();
      });
    });
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

      this.timeout(10000);

      scale.connect('foo', 'bar', 'banana');

      scale.on('error::connect', function error(err, key, value) {
        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.contain('integer');
        expect(key).to.equal('ff::foo::bar');
        expect(value).to.equal('http://localhost@banana');

        done();
      });
    });

    it('retrieve the "tailgators" when joining', function (done) {
      var scale = new Scaler(null, { namespace: 'ye' });

      scale.redis.sadd('ye::foo::bar::pipe', scale.uri +'@momoa', function (err) {
        if (err) return done(err);

        scale.connect('foo', 'bar', 'banana', function (err, tailgators) {
          if (err) return done(err);

          expect(tailgators).to.be.a('array');
          expect(tailgators[0]).to.equal(scale.uri +'@momoa');
          done();
        });
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

  describe('#pipe', function () {
    function transporter() {
      var request = { query: { account: 'foo' }}
        , t = transport(request);

      t.request = request;

      return t;
    }

    it('doesnt pipe to other accounts', function (done) {
      var socket = new Socket('id', server.engine, transporter());

      server.pipe(socket, 'bar', 'baz', function (err) {
        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.include('accounts');

        done();
      });
    });

    it('adds the socket id to the set');
    it('forwards a message to the socket that theres a new follower');
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
      server.uuid(function (socket, fn) {
        fn(null, 'sessionid');
      });

      var io = eio(server.uri + server.endpoint +'?m&session=sessionid&account=foo', {
        path: '/stream/'
      });

      io.on('open', function onopen() {
        server.forward('foo', 'sessionid', 'foobar', function (err) {
          if (err) return done(err);
        });
      });

      io.on('message', function onmessage(data) {
        expect(data).to.equal('foobar');
        io.close();
        done();
      });
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

      scale.emit('validate::foo', 'meh', new User(), '"meh"');
    });

    it('automatically detects the callback location with missing args', function (done) {
      var scale = new Scaler();

      scale.validate('foo', function(arg, brg, crg, drg, cb) {
        expect(arg).to.equal('foo');
        expect(!brg).to.equal(true);
        expect(!crg).to.equal(true);
        expect(!drg).to.equal(true);
        expect(cb).to.be.a('function');

        cb(undefined, true);
      }).once('stream::foo', function (msg, brg, crg, drg, raw, user) {
        expect(msg).to.equal('foo');
        expect(user).to.be.instanceOf(User);

        expect(JSON.stringify(msg)).to.equal(raw);

        done();
      });

      scale.emit('validate::foo', 'foo', new User(), '"foo"');
    });

    it('automatically detects the callback location with tomuch args', function (done) {
      var scale = new Scaler();

      scale.validate('foo', function(arg, cb) {
        expect(arg).to.equal('foo');
        expect(cb).to.be.a('function');

        cb(null, true);
      }).once('stream::foo', function (foo) {
        expect(foo).to.equal('foo');
        expect(arguments.length).to.equal(3);

        done();
      });

      scale.emit('validate::foo', 'foo', 'bar', 'baz', 'moo', '["foo", "bar", "baz", "moo"]');
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

      scale.emit('validate::foo', 'meh', new User(),'"meh"');
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

      scale.emit('validate::foo', 'meh', new User(), '"meh"');
    });

    it('calls stream:: event once the event was validated successfully', function (done) {
      var scale = new Scaler();

      scale.validate('foo', function validate(data, cb) {
        expect(data).to.equal('meh');
        expect(cb).to.be.a('function');

        cb();
      }).once('stream::foo', function (data, raw, user) {
        expect(data).to.equal('meh');
        expect(arguments.length).to.equal(3);
        expect(user).to.be.instanceOf(User);
        expect(JSON.parse(raw)).to.deep.equal(data);

        done();
      });

      scale.emit('validate::foo', 'meh', new User(), '"meh"');
    });
  });

  describe('#uuid & #generator', function () {
    it('sets a new id generator', function () {
      function generator() {}

      expect(server.generator).to.not.equal(generator);
      server.uuid(generator);
      expect(server.generator).to.equal(generator);
    });

    it('generates unique ids', function () {
      var ids = [];

      function append(err, id) {
        if (~ids.indexOf(id)) throw new Error('Fuck, not unique');
        ids.push(id);
      }

      for (var i = 0; i < 100; i++) server.generator({}, append);
    });
  });

  describe('#connection', function () {
    it('disconnects the socket');
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
