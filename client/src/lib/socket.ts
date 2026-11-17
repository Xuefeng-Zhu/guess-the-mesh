import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';
import type { PlayerView, RoomState } from '../../../server/src/shared';

let sock: Socket | null = null;
export function getSocket(): Socket {
  if (!sock) sock = io({ transports: ['websocket', 'polling'] });
  return sock;
}

export function call<T = any>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => getSocket().emit(event, payload ?? {}, (r: T) => resolve(r)));
}

/** Subscribes to room state; tracks server clock offset so timers line up across devices. */
export function useRoomState() {
  const [state, setState] = useState<RoomState | null>(null);
  const [me, setMe] = useState<PlayerView | null>(null);
  const [connected, setConnected] = useState(false);
  const offset = useRef(0);
  useEffect(() => {
    const s = getSocket();
    const onState = (st: RoomState) => {
      offset.current = st.serverNow - Date.now();
      setState(st);
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on('state', onState);
    s.on('me', setMe);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    setConnected(s.connected);
    return () => {
      s.off('state', onState);
      s.off('me', setMe);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, []);
  const now = () => Date.now() + offset.current;
  return { state, me, connected, now };
}

/** Re-render every `ms` (for countdowns). */
export function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
