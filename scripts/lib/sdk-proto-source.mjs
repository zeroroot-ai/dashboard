// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The one place that names where the OSS SDK protos come from.
 *
 * ADR-0028: a consumer in a language other than Go reads the SDK protos from
 * the Buf Schema Registry. `proto-generate.mjs` and `gen-authz-registry.mjs`
 * both import this reference, so the proto bindings and the authz registry
 * always come from the same SDK release.
 *
 * A release label of the SDK module does not move.
 *
 * To move to a new SDK release: change `SDK_BSR_VERSION` to the release that
 * the `go.mod` of gibson pins, run `pnpm proto:generate` and `pnpm gen:authz`,
 * and commit the generated files with the change.
 */

const SDK_BSR_MODULE = 'buf.build/zeroroot-ai/sdk';
const SDK_BSR_VERSION = 'v0.193.1';

export const SDK_BSR_REF = `${SDK_BSR_MODULE}:${SDK_BSR_VERSION}`;
