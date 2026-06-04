'use client';

import { useEffect, useRef, useState } from 'react';

import {
  ComponentGrant,
  CRDKind,
  GibsonCRD,
  Tenant,
  TenantMember,
  WatchEvent,
} from '@/src/lib/k8s/types';

type TypeForKind<K extends CRDKind> = K extends 'Tenant'
  ? Tenant
  : K extends 'TenantMember'
    ? TenantMember
    : K extends 'ComponentGrant'
      ? ComponentGrant
      : GibsonCRD;

interface UseCRDWatchOpts {
  enabled?: boolean;
  onEvent?: (evt: WatchEvent<GibsonCRD>) => void;
}

/**
 * Subscribes to a K8s watch stream via SSE proxy and maintains a keyed map
 * of CR objects. Reconnects on disconnect with exponential backoff.
 */
export function useCRDWatch<K extends CRDKind>(
  kind: K,
  namespace: string | undefined,
  opts: UseCRDWatchOpts = {},
): {
  items: Array<TypeForKind<K>>;
  status: 'idle' | 'connecting' | 'open' | 'error';
  error?: string;
} {
  const [items, setItems] = useState<Map<string, TypeForKind<K>>>(new Map());
  const [status, setStatus] = useState<'idle' | 'connecting' | 'open' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;

  useEffect(() => {
    if (opts.enabled === false) return;
    const pathSegments: string[] = [kind as string];
    if (namespace) pathSegments.push(namespace);
    const url = `/api/k8s/watch/${pathSegments.join('/')}`;

    let backoff = 1000;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');
      const es = new EventSource(url);
      esRef.current = es;
      es.onopen = () => {
        setStatus('open');
        setError(undefined);
        backoff = 1000;
      };
      es.onmessage = (e) => {
        try {
          const evt = JSON.parse(e.data) as WatchEvent<TypeForKind<K>>;
          onEventRef.current?.(evt as WatchEvent<GibsonCRD>);
          setItems((prev) => {
            const next = new Map(prev);
            const key = objectKey(evt.object);
            if (evt.type === 'DELETED') {
              next.delete(key);
            } else {
              next.set(key, evt.object);
            }
            return next;
          });
        } catch {
          // ignore malformed
        }
      };
      es.onerror = () => {
        setStatus('error');
        setError('connection lost');
        es.close();
        if (!cancelled) {
          setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 30_000);
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [kind, namespace, opts.enabled]);

  return { items: Array.from(items.values()), status, error };
}

function objectKey(obj: GibsonCRD): string {
  const ns = obj.metadata.namespace ?? '';
  return `${ns}/${obj.metadata.name}`;
}
