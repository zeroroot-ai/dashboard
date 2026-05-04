/**
 * Legacy Neo4j driver singleton for routes not yet ported to GraphService RPCs.
 *
 * These routes (findings CRUD, findings export, mission enrichment, status
 * aggregation, mission findings) still do direct Cypher and are NOT within
 * the scope of spec dashboard-direct-neo4j-removal. They will be ported to
 * daemon RPCs in a follow-on spec, at which point this file can be deleted
 * along with the direct-neo4j npm dep.
 *
 * DO NOT add new callers here. All new dashboard data paths must go through
 * the GraphService (or another daemon service) via userClient().
 *
 * Spec: dashboard-direct-neo4j-removal — residual shim for out-of-scope routes.
 */

import neo4j, { type Driver } from 'neo4j-driver';
import { serverConfig } from './config';

const NEO4J_URI = serverConfig.neo4jUri;
const NEO4J_USER = serverConfig.neo4jUser;
const NEO4J_PASSWORD = serverConfig.neo4jPassword;

let _legacyDriver: Driver | null = null;

/**
 * Get or create the legacy Neo4j driver singleton.
 *
 * Only use this from the residual routes listed in
 * src/lib/neo4j-legacy-driver.ts header — not from new code.
 */
export function getLegacyNeo4jDriver(): Driver {
  if (!_legacyDriver) {
    if (!NEO4J_PASSWORD) {
      console.warn('NEO4J_PASSWORD not set - legacy Neo4j driver may fail to connect');
    }
    _legacyDriver = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
      {
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 60000,
        maxTransactionRetryTime: 30000,
      },
    );
  }
  return _legacyDriver;
}
