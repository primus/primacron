describe('Primacron', function () {
  'use strict';

  var Primacron = require('../')
    , portnumbers = 1024
    , server
    , reds;

  beforeEach(function beforeEach(done) {
    server = new Primacron({
      port: ++portnumbers,
      listening: done
    });
  });

  afterEach(function afterEach(done) {
    server.destroy(done);
  });
});
