// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from 'vitest';

import { authSecrets } from '../auth-secrets';

describe('authSecrets', () => {
  it('lists the current secret first, then the previous one', () => {
    expect(authSecrets({ AUTH_SECRET: 'cur', AUTH_SECRET_PREVIOUS: 'prev' }))
      .toEqual(['cur', 'prev']);
  });

  it('drops an empty or absent previous secret', () => {
    expect(authSecrets({ AUTH_SECRET: 'cur', AUTH_SECRET_PREVIOUS: '' })).toEqual(['cur']);
    expect(authSecrets({ AUTH_SECRET: 'cur' })).toEqual(['cur']);
  });

  it('drops a previous secret that equals the current one', () => {
    expect(authSecrets({ AUTH_SECRET: 'same', AUTH_SECRET_PREVIOUS: 'same' })).toEqual(['same']);
  });

  it('is empty when no secret is set', () => {
    expect(authSecrets({})).toEqual([]);
  });
});
