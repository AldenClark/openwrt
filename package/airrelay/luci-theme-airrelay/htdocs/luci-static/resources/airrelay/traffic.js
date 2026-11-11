'use strict';

// Sample kernel byte counters in the active page. No extra daemon.
function bytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  const units = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
  let count = value, unit = 0;
  while (count >= 1024 && unit < units.length - 1) { count /= 1024; unit++; }
  return `${count.toFixed(unit === 0 || count >= 100 ? 0 : 1)} ${units[unit]}`;
}

function tracker() {
  const previous = {};
  return function(name, status) {
    const stats = status?.statistics;
    const rx = Number(stats?.rx_bytes), tx = Number(stats?.tx_bytes);
    if (!stats || !Number.isFinite(rx) || !Number.isFinite(tx) || rx < 0 || tx < 0) {
      delete previous[name];
      return null;
    }
    const now = Date.now(), old = previous[name];
    previous[name] = { rx, tx, time: now };
    const seconds = old ? (now - old.time) / 1000 : 0;
    const valid = old && seconds >= 1 && seconds <= 60 && rx >= old.rx && tx >= old.tx;
    return { rx, tx, rxRate: valid ? (rx - old.rx) / seconds : null,
      txRate: valid ? (tx - old.tx) / seconds : null };
  };
}

return { bytes, tracker };
