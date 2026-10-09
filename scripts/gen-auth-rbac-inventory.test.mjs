// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

// Tests for the network section of gen-auth-rbac-inventory.mjs (dashboard#269).
// The chart moved from one NetworkPolicy for each pod to Cilium policies that
// select pods by label (D76). The old reader matched only NetworkPolicy
// objects, so the inventory said that no policy gates the dashboard.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  networkPoliciesForDashboard,
  parseDocs,
  selectorMatches,
} from './gen-auth-rbac-inventory.mjs';

const RENDER = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gibson-dashboard
  namespace: gibson
spec:
  template:
    metadata:
      labels:
        app.kubernetes.io/component: dashboard
        gibson.zeroroot.ai/net-role: platform
        gibson.zeroroot.ai/client-redis: "true"
---
apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: deny-gibson
spec:
  endpointSelector:
    matchLabels:
      k8s:io.kubernetes.pod.namespace: gibson
---
apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: deny-other
spec:
  endpointSelector:
    matchLabels:
      k8s:io.kubernetes.pod.namespace: other
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: edge
  namespace: gibson
specs:
  - description: matches by Exists
    endpointSelector:
      matchExpressions:
        - key: gibson.zeroroot.ai/net-role
          operator: Exists
  - description: no match, another port
    endpointSelector:
      matchLabels:
        gibson.zeroroot.ai/metrics-port: "8080"
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: redis-elsewhere
  namespace: other
spec:
  endpointSelector:
    matchLabels:
      gibson.zeroroot.ai/client-redis: "true"
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: legacy
  namespace: gibson
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: dashboard
`;

test('the reader lists each policy rule set that selects the dashboard pod', () => {
  const got = networkPoliciesForDashboard(parseDocs(RENDER)).map(
    (p) => `${p.kind}/${p.name}/${p.spec.description ?? ''}`,
  );
  assert.deepEqual(got, [
    'CiliumClusterwideNetworkPolicy/deny-gibson/',
    'CiliumNetworkPolicy/edge/matches by Exists',
    'NetworkPolicy/legacy/',
  ]);
});

test('no dashboard Deployment means no policy', () => {
  assert.deepEqual(networkPoliciesForDashboard(parseDocs('kind: ConfigMap\n')), []);
});

test('selector operators', () => {
  const labels = { a: '1', b: '2' };
  assert.equal(selectorMatches({ matchLabels: { a: '1' } }, labels), true);
  assert.equal(selectorMatches({ matchLabels: { 'k8s:a': '1' } }, labels), true);
  assert.equal(selectorMatches({ matchLabels: { a: '2' } }, labels), false);
  assert.equal(selectorMatches({}, labels), true);
  assert.equal(selectorMatches(undefined, labels), false);
  const expr = (operator, values) => ({ matchExpressions: [{ key: 'a', operator, values }] });
  assert.equal(selectorMatches(expr('In', ['1', '3']), labels), true);
  assert.equal(selectorMatches(expr('In', ['3']), labels), false);
  assert.equal(selectorMatches(expr('NotIn', ['1']), labels), false);
  assert.equal(selectorMatches(expr('NotIn', ['3']), labels), true);
  assert.equal(selectorMatches(expr('Exists'), labels), true);
  assert.equal(selectorMatches(expr('DoesNotExist'), labels), false);
  assert.equal(selectorMatches(expr('Unknown'), labels), false);
});
