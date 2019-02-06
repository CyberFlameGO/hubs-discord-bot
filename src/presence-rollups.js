const EventEmitter = require('events');

// Data structure for tracking the series of arrivals/departures in a hub and rolling it up
// into a useful stream of Discord notifications. When new arrivals or departures happen, either
// a new notification will be produced, or the most recent notification will be amended.
//
// Fires two kinds of events:
// - "new", indicating that a new notification should be produced announcing the arrival or
//   departure of some set of users.
// - "update", indicating that the previous notification should be amended and whichever users
//   were announced in it should be replaced with the newly provided set of users.
//
class PresenceRollups extends EventEmitter {

  // note that there is one highly suspicious thing about this implementation; we don't have a consistent
  // way of tracking that a client who leaves and rejoins is "the same guy", so instead, we assume that people
  // with the same name are "the same guy" for purposes of collapsing rejoin notifications. thus why
  // pendingDepartures is keyed on name, not ID, and why it has an array of timeouts, instead of one.

  constructor(options) {
    super();

    // All of the notifications which have ever been produced, first to last.
    this.entries = []; // { kind, users: [{ id, name }], timestamp }

    // All of the departures which we're waiting on to see whether the guy quickly rejoins.
    this.pendingDepartures = {}; // { name: [timeout] }

    this.options = Object.assign({
      // The duration for which we wait to roll up multiple people's arrivals.
      arrive_rollup_leeway_ms: 60 * 1000,
      // The duration for which we wait to roll up multiple people's departures.
      depart_rollup_leeway_ms: 60 * 1000,
      // The duration for which we wait for someone to rejoin before we announce their departure.
      depart_rejoin_patience_ms: 15 * 1000,
    }, options);
  }

  latest() {
    return this.entries.length ? this.entries[this.entries.length - 1] : null;
  }

  arrive(id, name, timestamp) {
    const pending = (this.pendingDepartures[name] || []).pop();
    if (pending) {
      // don't bother reporting leave/rejoins
      clearTimeout(pending);
      return;
    }

    const prev = this.latest();
    if (prev != null && prev.kind === "arrive") {
      const elapsed = timestamp - prev.timestamp;
      if (elapsed <= this.options.arrive_rollup_leeway_ms ) {
        // roll it up into the last arrival notification
        prev.users.push({ id, name });
        prev.timestamp = timestamp;
        this.emit("update", prev);
        return;
      }
    }
    // create a new arrival notification
    const curr = { kind: "arrive", users: [{ id, name }], timestamp };
    this.entries.push(curr);
    this.emit("new", curr);
  }

  depart(id, name, timestamp) {
    // we don't know yet whether this person might quickly rejoin, so wait and see
    const delay = this.options.depart_rejoin_patience_ms;
    const pending = this.pendingDepartures[name] || (this.pendingDepartures[name] = []);
    pending.push(setTimeout(() => { this.finalizeDeparture(id, name, timestamp + delay); }, delay));
  }

  finalizeDeparture(id, name, timestamp) {
    (this.pendingDepartures[name] || []).pop();
    const prev = this.latest();
    if (prev != null && prev.kind === "depart") {
      const elapsed = timestamp - prev.timestamp;
      if (elapsed <= this.options.depart_rollup_leeway_ms) {
        // roll it up into the last departure notification
        prev.users.push({ id, name });
        prev.timestamp = timestamp;
        this.emit("update", prev);
        return;
      }
    }
    // create a new departure notification
    const curr = { kind: "depart", users: [{ id, name }], timestamp };
    this.entries.push(curr);
    this.emit("new", curr);
  }

}

module.exports = { PresenceRollups };