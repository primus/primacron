describe('Primacron', function () {
  'use strict';

  var transport = require('engine.io').transports.polling
    , EventEmitter = require('events').EventEmitter
    , Socket = require('engine.io').Socket
    , eio = require('engine.io-client')
    , request = require('request')
    , Primus = require('primus')
    , Primacron = require('../')
    , redis = require('redis')
    , chai = require('chai')
    , User = Primacron.User
    , expect = chai.expect
    , portnumbers = 1024
    , server
    , reds;

  //
  // Include a stack trace.
  //
  chai.Assertion.includeStack = true;

  beforeEach(function beforeEach(done) {
    server = new Primacron();
    server.listen(++portnumbers, done);
  });

  afterEach(function afterEach(done) {
    server.destroy(done);
  });

  it('requires and creates its own redis client if none is provided', function () {
    var reds = redis.createClient()
      , prima = new Primacron(reds);

    // should set the same client
    expect(prima.redis).to.equal(reds);

    prima = new Primacron();
    expect(prima.redis).to.not.equal(reds);
    expect(prima.redis).to.be.instanceOf(redis.RedisClient);
  });

  it('applies the configuration options', function () {
    var prima = new Primacron(null, {
      broadcast: '/foo/broadcast',
      endpoint: '/foo/endpoint',
      redirect: 'http://google.com',
      namespace: 'cows'
    });

    expect(prima.broadcast.toString()).to.equal('/foo/broadcast');
    expect(prima.endpoint.toString()).to.equal('/foo/endpoint');
    expect(prima.redirect).to.equal('http://google.com');
    expect(prima.namespace).to.equal('cows');
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
      var socket = new Socket('id', server.primus.transformer.service, transporter());

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
      var socket = new Socket('id', server.primus.transformer.service, transporter())
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
        expect(res.headers['x-powered-by']).to.equal('Primacron/v'+ server.version);
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

    it('redirects to the given redirect', function (done) {
      var prima = new Primacron(null, { redirect: 'http://google.com' });

      prima.listen(++portnumbers, function () {
        request({
          uri: prima.uri +'/cows',
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

          prima.destroy(done);
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
      var prima = new Primacron();

      expect(prima.networkaddress).to.equal('localhost');
      expect(prima.port).to.equal(null);

      prima.network('127.0.0.1');

      expect(prima.networkaddress).to.equal('127.0.0.1');
      expect(prima.port).to.equal(null);
    });

    it('sets the port', function () {
      var prima = new Primacron();

      expect(prima.networkaddress).to.equal('localhost');
      expect(prima.port).to.equal(null);

      prima.network('127.0.0.1', 2456);

      expect(prima.networkaddress).to.equal('127.0.0.1');
      expect(prima.port).to.equal(2456);
    });

    it('updates the values for the uri property', function () {
      var prima = new Primacron();

      expect(prima.uri).to.equal('http://localhost');

      prima.network('127.0.0.1');
      expect(prima.uri).to.equal('http://127.0.0.1');

      prima.network('internal.dns', 1337);
      expect(prima.uri).to.equal('http://internal.dns:1337');
    });
  });

  describe('#connect', function () {
    it('adds a new connection under the namespace', function (done) {
      var prima = new Primacron(null, { namespace: 'ns' });

      prima.connect('foo', 'bar', 'baz', function (err) {
        if (err) return done(err);

        prima.redis.get('ns::foo::bar', function (err, value) {
          if (err) return done(err);

          expect(value).to.equal('http://localhost@baz');
          done();
        });
      });
    });

    it('sets a expiree on the connection', function (done) {
      var prima = new Primacron(null, { namespace: 'ns2', timeout: 1 });

      prima.connect('foo', 'bar', 'baz', function (err) {
        if (err) return done(err);

        prima.redis.get('ns2::foo::bar', function (err, value) {
          if (err) return done(err);

          expect(value).to.equal('http://localhost@baz');

          setTimeout(function timeout() {
            prima.redis.get('ns2::foo::bar', function (err, value) {
              if (err) return done(err);

              expect(!value).to.equal(true);
              done();
            });
          }, 1000);
        });
      });
    });

    it('emits error::connect on failures', function (done) {
      var prima = new Primacron(null , { namespace: 'ff', timeout: 'this should fail' });

      this.timeout(10000);

      prima.connect('foo', 'bar', 'banana');

      prima.on('error::connect', function error(err, context) {
        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.contain('integer');
        expect(context.key).to.equal('ff::foo::bar');
        expect(context.value).to.equal('http://localhost@banana');

        done();
      });
    });

    it('retrieve the "tailgators" when joining', function (done) {
      var prima = new Primacron(null, { namespace: 'ye' });

      prima.redis.sadd('ye::foo::bar::pipe', prima.uri +'@momoa', function (err) {
        if (err) return done(err);

        prima.connect('foo', 'bar', 'banana', function (err, tailgators) {
          if (err) return done(err);

          expect(tailgators).to.be.a('array');
          expect(tailgators[0]).to.equal(prima.uri +'@momoa');
          done();
        });
      });
    });
  });

  describe('#disconnect', function () {
    it('removes the connection from redis', function (done) {
      var prima = new Primacron(null, { namespace: 'bar' });

      prima.connect('meh', 'bleh', 'spam', function (err) {
        if (err) return done(err);

        prima.disconnect('meh', 'bleh', 'spam', function (err) {
          if (err) return done(err);

          prima.redis.get('bar::meh::bleh', function (err, data) {
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
      var prima = new Primacron();

      prima.connect('foo', 'bar', 'banana', function () {
        prima.find('foo', 'bar', function (err, server, socket) {
          if (err) return done(err);

          expect(server).to.equal('http://localhost');
          expect(socket).to.equal('banana');
          done();
        });
      });
    });

    it('doesnt find anything', function (done) {
      var prima = new Primacron();

      prima.find('yo', 'momma', function (err, server, socket) {
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
      var socket = new Primus.Spark(new EventEmitter, {}, {}, {
        query: { account: 'foo' }
      }, 'id');

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
      server.once('error::invalid', function (err, context) {
        expect(err).to.be.instanceOf(Error);

        expect(context.raw).to.be.a('string');
        expect(context.raw).to.equal('{json:foo}');

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

          server.once('error::invalid', function (err, context) {
            expect(err).to.be.instanceOf(Error);

            expect(context.raw).to.be.a('string');
            expect(context.raw).to.equal(JSON.stringify(item.json));

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
      var prima = new Primacron();

      prima.validate('foo', function validate(data, cb) {
        expect(data).to.equal('meh');
        expect(cb).to.be.a('function');

        done();
      }).once('stream::foo', function () {
        throw new Error('Broken');
      });

      prima.emit('validate::foo', 'meh', new User(), '"meh"');
    });

    it('automatically detects the callback location with missing args', function (done) {
      var prima = new Primacron();

      prima.validate('foo', function(arg, brg, crg, drg, cb) {
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

      prima.emit('validate::foo', 'foo', new User(), '"foo"');
    });

    it('automatically detects the callback location with tomuch args', function (done) {
      var prima = new Primacron();

      prima.validate('foo', function(arg, cb) {
        expect(arg).to.equal('foo');
        expect(cb).to.be.a('function');

        cb(null, true);
      }).once('stream::foo', function (foo) {
        expect(foo).to.equal('foo');
        expect(arguments.length).to.equal(3);

        done();
      });

      prima.emit('validate::foo', 'foo', 'bar', 'baz', 'moo', '["foo", "bar", "baz", "moo"]');
    });

    it('emits error::validation when an error occures', function (done) {
      var prima = new Primacron();

      prima.validate('foo', function validate(data, cb) {
        expect(data).to.equal('meh');
        expect(cb).to.be.a('function');

        cb(undefined, false);
      });

      prima.once('error::validation', function validate(err, context) {
        expect(context.event).to.equal('foo');
        expect(context.user).to.be.instanceOf(User);

        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.equal('Failed to validate the data');

        done();
      }).once('stream::foo', function () {
        throw new Error('Broken');
      });

      prima.emit('validate::foo', 'meh', new User(),'"meh"');
    });

    it('emits error::validation when the validation fails', function (done) {
      var prima = new Primacron();

      prima.validate('foo', function validate(data, cb) {
        expect(data).to.equal('meh');
        expect(cb).to.be.a('function');

        cb(new Error('Failed to validate'));
      });

      prima.once('error::validation', function validate(err, context) {
        expect(context.event).to.equal('foo');
        expect(context.user).to.be.instanceOf(User);

        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.equal('Failed to validate');

        done();
      }).once('stream::foo', function () {
        throw new Error('Broken');
      });

      prima.emit('validate::foo', 'meh', new User(), '"meh"');
    });

    it('calls stream:: event once the event was validated successfully', function (done) {
      var prima = new Primacron();

      prima.validate('foo', function validate(data, cb) {
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

      prima.emit('validate::foo', 'meh', new User(), '"meh"');
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
