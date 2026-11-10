const angle = Math.PI * 2;
const quaternionRange = Math.SQRT1_2;

function packRotation(q) {
  let omitted = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[omitted])) omitted = i;
  const sign = q[omitted] < 0 ? -1 : 1;
  const norm = Math.hypot(...q) || 1;
  let bits = omitted, shift = 2;
  for (let i = 0; i < 4; i++) {
    if (i === omitted) continue;
    const value = Math.max(-1, Math.min(1, q[i] * sign / (norm * quaternionRange)));
    bits |= Math.round((value + 1) * 511.5) << shift;
    shift += 10;
  }
  return bits >>> 0;
}

function unpackRotation(bits) {
  const omitted = bits & 3, q = [];
  let squared = 0, shift = 2;
  for (let i = 0; i < 4; i++) {
    if (i === omitted) continue;
    q[i] = (((bits >>> shift) & 1023) / 511.5 - 1) * quaternionRange;
    squared += q[i] * q[i];
    shift += 10;
  }
  q[omitted] = Math.sqrt(Math.max(0, 1 - squared));
  return q;
}

export function encodeArenaState(actor, yaw, poseId) {
  const data = new Uint8Array(17), view = new DataView(data.buffer);
  data[0] = 1;
  for (const [i, v] of actor.pos.toArray().entries()) {
    view.setInt16(1 + i * 2, Math.round(Math.max(-16000, Math.min(16000, v))), true);
  }
  view.setUint32(7, packRotation(actor.root.quaternion.toArray()), true);
  data[11] = Math.round((yaw % angle + angle) % angle * 256 / angle) & 255;
  view.setInt8(12, Math.round(Math.max(-128, Math.min(127, actor.pos.y - actor.root.position.y))));
  data[13] = Math.round(Math.max(0, Math.min(100, actor.hp)));
  data[14] = poseId >= 0 && poseId < 255 ? poseId : 255;
  data[15] = actor.actionVersion ?? 0;
  data[16] = actor.playingPose ? 1 : 0;
  return data;
}

export function encodeArenaHit(id, amount) {
  const data = new Uint8Array(4);
  data[0] = 2;
  new DataView(data.buffer).setUint16(1, id, true);
  data[3] = Math.round(amount);
  return data;
}

export function decodeArenaTick(buffer, states) {
  const view = new DataView(buffer);
  if (view.getUint8(0) !== 16) throw Error('Unknown arena packet');
  const time = view.getUint32(1, true), changed = [], hits = [];
  for (let p = 5; p < view.byteLength;) {
    const id = view.getUint16(p, true), mask = view.getUint8(p + 2);
    p += 3;
    if (mask === 16) {
      hits.push({id, damage: view.getUint8(p++)});
      continue;
    }
    const state = states.get(id);
    if (!state || !mask || (mask & ~15)) throw Error('Unexpected arena delta');
    if (mask & 1) {
      state.position = [view.getInt16(p, true), view.getInt16(p + 2, true), view.getInt16(p + 4, true)];
      p += 6;
    }
    if (mask & 2) {
      state.rotation = unpackRotation(view.getUint32(p, true));
      state.yaw = view.getUint8(p + 4) * angle / 256;
      p += 5;
    }
    if (mask & 4) {
      state.offset = view.getInt8(p++);
      state.hp = view.getUint8(p++);
    }
    if (mask & 8) {
      state.poseId = view.getUint8(p++);
      state.action = view.getUint8(p++);
      state.once = Boolean(view.getUint8(p++) & 1);
    }
    state.time = time;
    changed.push([id, state]);
  }
  return {time, changed, hits};
}

export async function arenaEndpoint() {
  const response = await fetch('arena-status', {signal: AbortSignal.timeout(3000)});
  if (!response.ok) throw Error('Използвай Start NNK LAN.cmd за мрежова игра.');
  const status = await response.json();
  if (status.protocol !== 2 || !Number.isInteger(status.wsPort)) throw Error('Стартирай обновения LAN сървър.');
  const url = new URL('/arena-ws', location.href);
  url.protocol = 'ws:';
  url.port = status.wsPort;
  return url;
}

export function openArena(url, profile) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const timeout = setTimeout(() => fail('LAN връзката не отговори'), 5000);
    function fail(message) {
      clearTimeout(timeout);
      reject(Error(message));
      socket.close();
    }
    socket.onopen = () => socket.send(JSON.stringify(profile));
    socket.onerror = () => fail('LAN връзката прекъсна');
    socket.onclose = () => fail('LAN връзката прекъсна');
    socket.onmessage = event => {
      try {
        const hello = JSON.parse(event.data);
        if (hello.error || !hello.room) return fail(hello.error || 'Невалиден отговор от стаята');
        clearTimeout(timeout);
        socket.onmessage = socket.onerror = socket.onclose = null;
        resolve({socket, ...hello});
      } catch {
        fail('Невалиден отговор от стаята');
      }
    };
  });
}
