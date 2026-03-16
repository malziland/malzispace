'use strict';

const ROOM_RE = /^[a-z0-9]{6,24}$/;

function sanitizeRoom(room) {
  if (typeof room !== 'string') return null;
  const v = room.trim().toLowerCase();
  if (!ROOM_RE.test(v)) return null;
  return v;
}

module.exports = { sanitizeRoom };

