import { useEffect } from 'react';
import * as Network from 'expo-network';

import { drainOutbox } from './drain';

// Safety-net interval in case a connectivity-change event is missed (this
// has been observed in Expo Go on some Android versions) — keeps the
// outbox from getting stuck pending forever while the app is foregrounded.
const SAFETY_NET_INTERVAL_MS = 30_000;

/**
 * Wires the offline outbox drainer to the app lifecycle: drains once on
 * mount (covers "connectivity was already back when the app restarted"),
 * again on every network state change that regains connectivity, and on a
 * periodic safety-net timer while the app is open. Mount this once near
 * the app root — it has no UI and holds no state a screen would need.
 */
export function useOutboxSync() {
  useEffect(() => {
    drainOutbox();

    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        drainOutbox();
      }
    });

    const interval = setInterval(() => {
      drainOutbox();
    }, SAFETY_NET_INTERVAL_MS);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, []);
}
