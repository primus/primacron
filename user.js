'use strict';

/**
 * Simple user interface which will optimize our memory usage.
 *
 * @constructor
 * @param {String} account The account id.
 * @param {String} session the session id.
 * @param {String} id The Engine.IO socket id
 * @api private
 */
function User(account, session, id) {
  this.account = account;
  this.session = session;
  this.id = this;
}

//
// Expose the user interface.
//
module.exports = User;
