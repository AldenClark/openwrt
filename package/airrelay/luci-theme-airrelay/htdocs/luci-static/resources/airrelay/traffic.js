'use strict';
'require baseclass';

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

// Uptime timestamps avoid NTP clock changes. Invalid rows, counter resets and
// missing samples break the line rather than inventing traffic or zeroes.
function history(text, uptime) {
  if (!Number.isFinite(uptime) || uptime < 0) return [];
  let previous = null;
  const result = [];
  for (const line of String(text || '').trim().split('\n')) {
    if (!/^\d+ \d+ \d+$/.test(line)) { previous = null; continue; }
    const [time, rx, tx] = line.split(' ').map(Number);
    if (![time, rx, tx].every(Number.isSafeInteger) || time > uptime) {
      previous = null;
      continue;
    }
    const seconds = previous ? time - previous.time : 0;
    const valid = previous && seconds > 0 && seconds <= 45 && rx >= previous.rx && tx >= previous.tx;
    if (time >= uptime - 3600)
      result.push({ time, rxRate: valid ? (rx - previous.rx) / seconds : null,
        txRate: valid ? (tx - previous.tx) / seconds : null });
    previous = { time, rx, tx };
  }
  return result;
}

function linePath(samples, side, uptime) {
  const max = Math.max(1, ...samples.map(s => s[side + 'Rate'] || 0));
  let connected = false;
  return samples.map(s => {
    const value = s[side + 'Rate'];
    if (value == null) { connected = false; return ''; }
    const command = connected ? 'L' : 'M';
    connected = true;
    const x = Math.max(0, Math.min(320, (s.time - uptime + 3600) / 3600 * 320));
    return `${command}${x.toFixed(1)},${(75 - value / max * 62).toFixed(1)}`;
  }).join(' ');
}

return baseclass.extend({ bytes, tracker, history, linePath });
