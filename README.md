# Scaler

Scaler is a small API wrapper for Engine.IO that takes care of our "scaling" and
multi server logic. This keeps our services as light as possible.

## Error events

To be a as module agnostic as possible, we don't log errors or broken code
instead we emit namespaced `error::<errtype>` events. These events can be
listend on by the applications and decide if they want to log it.

The following error events are emitted:

<dl>
  <dt>error::connect</dt>
  <dd><strong>key, value</strong></dd>
  <dd>
    We failed to store our connection in the provided redis database. The
    connection cannot be found by other node processes. So no broadcasting would
    be possible. This should be seen as a critical error.
  </dd>

  <dt>error::disconnect</dt>
  <dd><strong>key, value</strong></dd>
  <dd>
    We failed to remove the connection in the provided redis database. While it
    should automatically expire it could result in false positives and pointless
    broadcasts to the given server. This isn't a critical error but could
    indicate database failure.
  </dd>

  <dd>error::json</dt>
  <dd><strong>message</strong></dd>
  <dd>
    We failed to parse the received message by our decoder. This shouldn't
    happen ever, if it does you could assume that some is trying to crash the
    server or to find back doors. This should be seen a critical error.
  </dd>

  <dd>error::invalid</dd>
  <dd><strong>message</strong></dd>
  <dd>
    We received a JSON document, but it wasn't an Object.. Someone is tyring to
    do fishy things with the server and action should be taken.. Cause as above.
  </dd>

  <dd>error::validation</dd>
  <dd><strong>event, error</strong></dd>
  <dd>
    The received message event was invalid.
  </dd>
</dl>
