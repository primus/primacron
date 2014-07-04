'use strict';

//
// Bump max-sockets to something more sane.
//
require('https').globalAgent.maxSockets =
 require('http').globalAgent.maxSockets = Infinity;

var Primacron = require('primacron')
  , argv = require('argh').argv
  , fs = require('fs');

//
// Create the Primacron server and make it listen to all the ports given to us.
//
var primacron = new Primacron({
  request: function request(req, res) {
    res.setHeader('Content-Type', 'text/html');
    fs.createReadStream(__dirname +'/index.html').pipe(res);
  },
  redis: require('redis').createClient(),
  port: +argv.port || 8080
});

//
// Store the client library in the directory which is a pre-configured Primus
// instance.
//
primacron.save(__dirname +'/primacron.js');

//
// Add a validator for incoming ping messages. This allows us to ensure that
// every ping packet that we receive is actually a real number type.
//
primacron.validate('ping', function validate(ping, validates) {
  if ('number' !== typeof ping) {
    return validates(new Error('ping packet should be a number'));
  }

  return validates();
});

//
// We've received a validated ping message from the client, respond with a pong
// of the same data so we can check the latency between these packets.
//
primacron.on('ping', function ping(spark, pong) {
  spark.emit('pong', pong);
});

primacron.on('invalid', function invalid(err) {
  console.log('received error for', err.event, err);
});

//
// if the process is the leader of the stack it will start broadcasting the
// concurrency to every connected client.
//
if (argv.leader) setTimeout(function connections() {
  primacron.getConnections(function get(err, nr) {
    primacron.forward.broadcast({
      emit: ['concurrent', nr]
    }, function broadcasted(err, reach) {
      if (err) {
        console.log(err);
      } else {
        console.log(reach);
        console.log('broadcasted my concurrency', nr, 'to', reach.send, 'clients');
      }
      setTimeout(connections, +argv.leader || 5000);
    });
  });
}, +argv.leader || 5000);

primacron.once('listening', function () {
  console.log('server listening on port', primacron.address().port);
});
