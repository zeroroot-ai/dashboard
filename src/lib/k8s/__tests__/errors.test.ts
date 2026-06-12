/**
 * Unit tests for mapK8sError (dashboard#751).
 *
 * @kubernetes/client-node throws ApiException with `.code` and a raw
 * JSON-string `.body`; the mapper previously read only the legacy
 * HttpError shape (`.statusCode` + parsed `.body` object), so every
 * ApiException mapped to status 0 → K8sUnavailableError. On the
 * slug-availability route that turned the happy path (404 = name
 * available) into a multi-KB warn per keystroke.
 */

import { describe, expect, it } from 'vitest';
import { ApiException } from '@kubernetes/client-node';

import {
  K8sConflictError,
  K8sError,
  K8sForbiddenError,
  K8sNotFoundError,
  K8sUnavailableError,
  K8sValidationError,
  mapK8sError,
} from '../errors';

const statusBody = (message: string) =>
  JSON.stringify({ kind: 'Status', status: 'Failure', message });

describe('mapK8sError', () => {
  it('maps an ApiException 404 (code + JSON-string body) to K8sNotFoundError', () => {
    const err = new ApiException(
      404,
      'HTTP-Code: 404\nMessage: Unknown API Status Code!',
      statusBody('tenants.gibson.zeroroot.ai "test" not found'),
      {},
    );

    const mapped = mapK8sError(err);

    expect(mapped).toBeInstanceOf(K8sNotFoundError);
    expect(mapped.message).toBe('tenants.gibson.zeroroot.ai "test" not found');
  });

  it.each([
    [403, K8sForbiddenError],
    [409, K8sConflictError],
    [422, K8sValidationError],
    [500, K8sUnavailableError],
  ])('maps an ApiException %i to the right class', (code, cls) => {
    expect(mapK8sError(new ApiException(code, 'msg', statusBody('m'), {}))).toBeInstanceOf(cls);
  });

  it('still maps the legacy HttpError shape (statusCode + parsed body)', () => {
    const mapped = mapK8sError({
      statusCode: 404,
      body: { message: 'not found' },
    });

    expect(mapped).toBeInstanceOf(K8sNotFoundError);
    expect(mapped.message).toBe('not found');
  });

  it('falls back to err.message when the body is non-JSON', () => {
    const mapped = mapK8sError(new ApiException(404, 'plain message', 'not json', {}));

    expect(mapped).toBeInstanceOf(K8sNotFoundError);
    expect(mapped.message).toContain('plain message');
  });

  it('maps a status-less error to K8sUnavailableError', () => {
    expect(mapK8sError(new Error('ECONNREFUSED'))).toBeInstanceOf(K8sUnavailableError);
  });

  it('passes through existing K8sError instances', () => {
    const original = new K8sNotFoundError('already mapped');
    expect(mapK8sError(original)).toBe(original);
    expect(mapK8sError(new K8sError('generic'))).toBeInstanceOf(K8sError);
  });
});
