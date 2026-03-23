// Activity monitor: stderr spinner + watchdog timer.
// start(label?) — begins spinner + watchdog; safe to call only in real IMAP mode.
// ping()        — resets the watchdog deadline; call at the top of each email iteration.
// stop()        — clears all timers and wipes the spinner line.

const SPIN_INTERVAL_MS  = 1_000;   // spinner frame advance rate
const WATCHDOG_CHECK_MS = 5_000;   // how often to poll for a hang
const HANG_THRESHOLD_MS = 30_000;  // silence before forced exit

const FRAMES = ['.', '..', '...'];

let spinnerTimer  = null;
let watchdogTimer = null;
let frameIndex    = 0;
let lastPingAt    = null;
let spinnerActive = false;
let spinnerLabel  = '';

export function start(label = 'extracting emails') {
  spinnerLabel = label;
  lastPingAt   = Date.now();
  frameIndex   = 0;

  if (process.stderr.isTTY) {
    spinnerActive = true;
    spinnerTimer  = setInterval(() => {
      process.stderr.write(`\r${spinnerLabel} ${FRAMES[frameIndex % FRAMES.length]}   `);
      frameIndex++;
    }, SPIN_INTERVAL_MS);
  }

  watchdogTimer = setInterval(() => {
    if (lastPingAt !== null && Date.now() - lastPingAt > HANG_THRESHOLD_MS) {
      stop();
      process.stderr.write('\nProcess appears hung — no activity for 30 s. Exiting.\n');
      process.exit(1);
    }
  }, WATCHDOG_CHECK_MS);
}

export function ping() {
  lastPingAt = Date.now();
}

export function stop() {
  if (spinnerTimer !== null) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  if (spinnerActive) {
    // Overwrite spinner line with blanks then return cursor to column 0.
    process.stderr.write('\r' + ' '.repeat(spinnerLabel.length + 8) + '\r');
    spinnerActive = false;
  }
  lastPingAt = null;
}
