/**
 * Minimal SPIFFE Workload API gRPC client for FetchJWTSVID.
 *
 * Hand-rolls protobuf encoding for the two messages we need, avoiding any
 * runtime proto loader or generated code. The encoding follows proto3 wire
 * format (varint / length-delimited) for exactly the fields used by
 * SpiffeWorkloadAPI.FetchJWTSVID.
 *
 * Wire reference: https://github.com/spiffe/go-spiffe/blob/main/v2/proto/spiffe/workload/workload.proto
 *
 * SPIRE Workload API protocol quirk:
 *   Every call MUST carry gRPC metadata `workload.spiffe.io: true`. Without
 *   it, SPIRE rejects the call with a protocol-mismatch status.
 *
 * Socket path format: `unix:///run/spire/sockets/agent.sock`
 *
 * This module has NO module-level side effects — no sockets are opened,
 * no env vars are read, nothing is stateful at import time.
 */

import grpc from '@grpc/grpc-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JWTSVIDRequest {
  /** SPIFFE URI audience list — usually a single daemon URI. */
  audience: string[];
  /** Optional: filter to a specific SPIFFE ID (leave empty for default). */
  spiffe_id?: string;
}

export interface JWTSVID {
  /** The SPIFFE ID encoded in the JWT subject. */
  spiffe_id: string;
  /** Compact JWT-SVID string. */
  svid: string;
}

export interface JWTSVIDResponse {
  svids: JWTSVID[];
}

// ---------------------------------------------------------------------------
// Proto3 wire encoding helpers
// ---------------------------------------------------------------------------
//
// Proto3 wire types:
//   0 = varint
//   2 = length-delimited (string, bytes, embedded message, repeated)
//
// Field tag = (field_number << 3) | wire_type

/** Encode an unsigned varint into a Buffer. */
function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0; // treat as unsigned 32-bit
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = v >>> 7;
  }
  bytes.push(v & 0x7f);
  return Buffer.from(bytes);
}

/** Encode a length-delimited field (string / bytes / message). */
function encodeLengthDelimited(fieldNumber: number, data: Buffer): Buffer {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const len = encodeVarint(data.length);
  return Buffer.concat([tag, len, data]);
}

/** Encode a string field. */
function encodeString(fieldNumber: number, value: string): Buffer {
  return encodeLengthDelimited(fieldNumber, Buffer.from(value, 'utf8'));
}

// ---------------------------------------------------------------------------
// JWTSVIDRequest encoder
//
// message JWTSVIDRequest {
//   repeated string audience = 1;   // field 1, wire type 2
//   string spiffe_id        = 2;    // field 2, wire type 2 (optional)
// }
// ---------------------------------------------------------------------------

function encodeJWTSVIDRequest(req: JWTSVIDRequest): Buffer {
  const parts: Buffer[] = [];
  for (const aud of req.audience) {
    parts.push(encodeString(1, aud));
  }
  if (req.spiffe_id) {
    parts.push(encodeString(2, req.spiffe_id));
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// JWTSVIDResponse decoder
//
// message JWTSVID {
//   string spiffe_id = 1;   // field 1, wire type 2
//   string svid     = 2;    // field 2, wire type 2
//   // hint/bundle fields 3,4 — ignored
// }
//
// message JWTSVIDResponse {
//   repeated JWTSVID svids = 1;   // field 1, wire type 2
// }
// ---------------------------------------------------------------------------

/** Read a varint from buf at position, return [value, nextPos]. */
function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++]!;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

/** Decode a JWTSVID message from a Buffer. */
function decodeJWTSVID(buf: Buffer): JWTSVID {
  let pos = 0;
  let spiffe_id = '';
  let svid = '';

  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    pos = p1;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;

    if (wireType === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const bytes = buf.subarray(pos, pos + len);
      pos += len;
      if (fieldNumber === 1) spiffe_id = bytes.toString('utf8');
      else if (fieldNumber === 2) svid = bytes.toString('utf8');
      // field 3+ (hint/bundle) — skip
    } else if (wireType === 0) {
      // varint field — skip
      const [, p2] = readVarint(buf, pos);
      pos = p2;
    } else {
      // Unknown wire type — give up on remainder rather than mis-parse.
      break;
    }
  }

  return { spiffe_id, svid };
}

/** Decode a JWTSVIDResponse message from a Buffer. */
function decodeJWTSVIDResponse(buf: Buffer): JWTSVIDResponse {
  const svids: JWTSVID[] = [];
  let pos = 0;

  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    pos = p1;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;

    if (wireType === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const bytes = buf.subarray(pos, pos + len);
      pos += len;
      if (fieldNumber === 1) {
        svids.push(decodeJWTSVID(bytes));
      }
      // field 2 (federated_bundles, map) — skip
    } else if (wireType === 0) {
      const [, p2] = readVarint(buf, pos);
      pos = p2;
    } else {
      break;
    }
  }

  return { svids };
}

// ---------------------------------------------------------------------------
// gRPC client definition
// ---------------------------------------------------------------------------

/** The gRPC service method map for makeGenericClientConstructor. */
const WORKLOAD_API_METHODS = {
  FetchJWTSVID: {
    // grpc-js requires `path` (the fully-qualified RPC path used by
    // Channel#createCall) AND `originalName`. SPIRE Workload API service is
    // `SpiffeWorkloadAPI` with no package prefix.
    path: '/SpiffeWorkloadAPI/FetchJWTSVID',
    originalName: 'FetchJWTSVID',
    requestStream: false,
    responseStream: false,
    requestSerialize: (req: JWTSVIDRequest): Buffer => encodeJWTSVIDRequest(req),
    requestDeserialize: (buf: Buffer): JWTSVIDRequest => {
      // Deserialization is only exercised server-side; unused in client.
      void buf;
      return { audience: [] };
    },
    responseSerialize: (res: JWTSVIDResponse): Buffer => {
      // Serialization is only exercised server-side; unused in client.
      void res;
      return Buffer.alloc(0);
    },
    responseDeserialize: (buf: Buffer): JWTSVIDResponse =>
      decodeJWTSVIDResponse(buf),
  },
} as const;

/** The minimal required metadata key for SPIRE Workload API calls. */
const WORKLOAD_API_METADATA_KEY = 'workload.spiffe.io';

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Fetch a JWT-SVID from the SPIRE Workload API via the agent socket.
 *
 * @param audience - SPIFFE audience URIs for the requested JWT.
 * @param socketPath - Full socket address, e.g. `unix:///run/spire/sockets/agent.sock`.
 * @param timeoutMs - Deadline for the call in milliseconds (default 5000).
 * @returns The raw JWT string for the first SVID returned.
 */
export async function fetchJWTSVID(
  audience: string[],
  socketPath: string,
  timeoutMs = 5_000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Build a one-shot gRPC client. The socket is local-UDS so the channel
    // uses insecure credentials (no TLS on a Unix socket).
    const ClientCtor = grpc.makeGenericClientConstructor(
      // The grpc-js type for ServiceDefinition requires methods typed as
      // `MethodDefinition<RequestType, ResponseType>` with exact shapes that
      // don't overlap cleanly with our typed version. Cast through `unknown`
      // to suppress the spurious overlap error — the runtime shape is correct.
      WORKLOAD_API_METHODS as unknown as Parameters<typeof grpc.makeGenericClientConstructor>[0],
      'SpiffeWorkloadAPI',
      {},
    );

    const client = new ClientCtor(
      socketPath,
      grpc.credentials.createInsecure(),
      {
        // Surface connection errors quickly instead of retrying indefinitely.
        'grpc.enable_retries': 0,
        // Keepalive settings appropriate for a local UDS.
        'grpc.keepalive_time_ms': 10_000,
        'grpc.keepalive_timeout_ms': 5_000,
      },
    );

    // SPIRE requires the workload-API marker on every call.
    const meta = new grpc.Metadata();
    meta.set(WORKLOAD_API_METADATA_KEY, 'true');

    const deadline = new Date(Date.now() + timeoutMs);

    (client as unknown as {
      FetchJWTSVID: (
        req: JWTSVIDRequest,
        meta: grpc.Metadata,
        opts: grpc.CallOptions,
        cb: (err: grpc.ServiceError | null, res?: JWTSVIDResponse) => void,
      ) => void;
    }).FetchJWTSVID(
      { audience },
      meta,
      { deadline },
      (err, res) => {
        // Always close the channel after a single-shot call.
        client.close();

        if (err) {
          reject(err);
          return;
        }
        const svid = res?.svids?.[0]?.svid;
        if (!svid) {
          reject(new Error('SPIRE returned an empty SVID list'));
          return;
        }
        resolve(svid);
      },
    );
  });
}
