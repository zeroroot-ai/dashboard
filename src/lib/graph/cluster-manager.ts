/**
 * ClusterManager - Spatial isolation and grouping for mission_run clusters
 *
 * Groups nodes by their parent mission_run and provides cluster-based layout forces
 * to keep mission runs spatially separated. Supports focused cluster visualization
 * where one cluster is emphasized while others are dimmed.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * 3D vector for positions and calculations
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 3D node with position, velocity, and metadata
 * Compatible with Node3D from KnowledgeGraph3D.tsx
 */
export interface Node3D {
  id: string;
  position: Vec3;
  velocity: Vec3;
  labels: string[];
  properties: Record<string, unknown>;
  color: string;
  size: number;
  screenX?: number;
  screenY?: number;
  screenSize?: number;
}

/**
 * 3D edge connecting two nodes
 */
export interface Edge3D {
  id: string;
  source: string;
  target: string;
  type: string;
  color: string;
}

/**
 * Represents a spatial cluster of nodes grouped by mission_run
 */
export interface Cluster {
  /** Unique identifier for the cluster */
  id: string;
  /** Mission run node ID that anchors this cluster */
  missionRunId: string;
  /** Set of all node IDs belonging to this cluster */
  nodeIds: Set<string>;
  /** Calculated center point (centroid) of all cluster nodes */
  center: Vec3;
  /** Calculated radius encompassing all cluster nodes */
  radius: number;
}

// ============================================================================
// ClusterManager Class
// ============================================================================

/**
 * Manages mission_run-based clustering for spatial isolation in graph layout.
 *
 * Features:
 * - Identifies mission_run nodes as cluster roots
 * - Traverses edges to find descendant nodes (agent_runs, tool_executions, findings, etc.)
 * - Calculates cluster centers and radii dynamically
 * - Applies inter-cluster repulsion forces to maintain separation
 * - Supports cluster focus for visual emphasis
 * - Handles orphan nodes (nodes without mission_run parent) in default cluster
 */
export class ClusterManager {
  private clusters: Map<string, Cluster> = new Map();
  private nodeToCluster: Map<string, string> = new Map();
  private focusedClusterId: string | null = null;

  /**
   * Assign nodes to clusters based on mission_run hierarchy.
   *
   * Algorithm:
   * 1. Identify all mission_run nodes as cluster roots
   * 2. For each mission_run, traverse edges to find all descendants
   * 3. Create a default cluster for orphan nodes (no mission_run parent)
   * 4. Calculate cluster centers and radii
   *
   * @param nodes - All nodes in the graph
   * @param edges - All edges in the graph
   * @returns Map of cluster ID to Cluster object
   */
  assignClusters(nodes: Node3D[], edges: Edge3D[]): Map<string, Cluster> {
    // Clear previous state
    this.clusters.clear();
    this.nodeToCluster.clear();

    // Build adjacency map for efficient traversal (parent -> children)
    const adjacencyMap = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!adjacencyMap.has(edge.source)) {
        adjacencyMap.set(edge.source, new Set());
      }
      adjacencyMap.get(edge.source)!.add(edge.target);
    }

    // Build reverse map (child -> parents) for finding mission_run ancestors
    const reverseMap = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!reverseMap.has(edge.target)) {
        reverseMap.set(edge.target, new Set());
      }
      reverseMap.get(edge.target)!.add(edge.source);
    }

    // Node ID lookup map
    const nodeMap = new Map<string, Node3D>(nodes.map((n) => [n.id, n]));

    // Step 1: Identify mission_run nodes
    const missionRunNodes = nodes.filter((node) =>
      node.labels.includes('mission_run')
    );

    // Step 2: For each mission_run, traverse descendants and create cluster
    for (const missionRunNode of missionRunNodes) {
      const clusterNodeIds = new Set<string>();
      clusterNodeIds.add(missionRunNode.id);

      // BFS to find all descendants
      const queue: string[] = [missionRunNode.id];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const children = adjacencyMap.get(currentId);
        if (children) {
          for (const childId of Array.from(children)) {
            clusterNodeIds.add(childId);
            queue.push(childId);
          }
        }
      }

      // Create cluster
      const cluster: Cluster = {
        id: `cluster_${missionRunNode.id}`,
        missionRunId: missionRunNode.id,
        nodeIds: clusterNodeIds,
        center: { x: 0, y: 0, z: 0 },
        radius: 0,
      };

      // Mark all nodes as belonging to this cluster
      for (const nodeId of Array.from(clusterNodeIds)) {
        this.nodeToCluster.set(nodeId, cluster.id);
      }

      this.clusters.set(cluster.id, cluster);
    }

    // Step 3: Create default cluster for orphan nodes
    const orphanNodeIds = new Set<string>();
    for (const node of nodes) {
      if (!this.nodeToCluster.has(node.id)) {
        orphanNodeIds.add(node.id);
      }
    }

    if (orphanNodeIds.size > 0) {
      const defaultCluster: Cluster = {
        id: 'cluster_default',
        missionRunId: '', // No specific mission_run
        nodeIds: orphanNodeIds,
        center: { x: 0, y: 0, z: 0 },
        radius: 0,
      };

      for (const nodeId of Array.from(orphanNodeIds)) {
        this.nodeToCluster.set(nodeId, defaultCluster.id);
      }

      this.clusters.set(defaultCluster.id, defaultCluster);
    }

    // Step 4: Calculate cluster centers and radii
    this.updateClusterGeometry(nodeMap);

    return this.clusters;
  }

  /**
   * Calculate cluster center (centroid) and radius based on member node positions.
   *
   * @param nodeMap - Map of node ID to Node3D for position lookup
   */
  private updateClusterGeometry(nodeMap: Map<string, Node3D>): void {
    for (const cluster of Array.from(this.clusters.values())) {
      if (cluster.nodeIds.size === 0) continue;

      // Calculate centroid
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let count = 0;

      for (const nodeId of Array.from(cluster.nodeIds)) {
        const node = nodeMap.get(nodeId);
        if (node) {
          sumX += node.position.x;
          sumY += node.position.y;
          sumZ += node.position.z;
          count++;
        }
      }

      if (count > 0) {
        cluster.center.x = sumX / count;
        cluster.center.y = sumY / count;
        cluster.center.z = sumZ / count;
      }

      // Calculate radius (max distance from center to any member node)
      let maxDistSq = 0;
      for (const nodeId of Array.from(cluster.nodeIds)) {
        const node = nodeMap.get(nodeId);
        if (node) {
          const dx = node.position.x - cluster.center.x;
          const dy = node.position.y - cluster.center.y;
          const dz = node.position.z - cluster.center.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > maxDistSq) {
            maxDistSq = distSq;
          }
        }
      }

      cluster.radius = Math.sqrt(maxDistSq);

      // Ensure minimum radius for small clusters
      if (cluster.radius < 50) {
        cluster.radius = 50;
      }
    }
  }

  /**
   * Get the center position of a specific cluster.
   *
   * @param clusterId - ID of the cluster
   * @returns Center position or null if cluster not found
   */
  getClusterCenter(clusterId: string): Vec3 | null {
    const cluster = this.clusters.get(clusterId);
    return cluster ? { ...cluster.center } : null;
  }

  /**
   * Get the radius of a specific cluster.
   *
   * @param clusterId - ID of the cluster
   * @returns Radius or 0 if cluster not found
   */
  getClusterRadius(clusterId: string): number {
    const cluster = this.clusters.get(clusterId);
    return cluster ? cluster.radius : 0;
  }

  /**
   * Set which cluster is currently focused (emphasized).
   * Pass null to clear focus (show all clusters equally).
   *
   * @param clusterId - ID of cluster to focus, or null to clear
   */
  setFocusedCluster(clusterId: string | null): void {
    this.focusedClusterId = clusterId;
  }

  /**
   * Get the currently focused cluster ID.
   *
   * @returns Focused cluster ID or null if none focused
   */
  getFocusedCluster(): string | null {
    return this.focusedClusterId;
  }

  /**
   * Get which cluster a specific node belongs to.
   *
   * @param nodeId - ID of the node
   * @returns Cluster ID or null if node not assigned
   */
  getClusterForNode(nodeId: string): string | null {
    return this.nodeToCluster.get(nodeId) || null;
  }

  /**
   * Check if a node belongs to the currently focused cluster.
   * Returns true if no cluster is focused (all nodes visible).
   *
   * @param nodeId - ID of the node
   * @returns True if node is in focused cluster or no focus set
   */
  isNodeInFocusedCluster(nodeId: string): boolean {
    if (!this.focusedClusterId) return true;
    return this.getClusterForNode(nodeId) === this.focusedClusterId;
  }

  /**
   * Calculate inter-cluster repulsion force for a specific node.
   *
   * Returns a force vector that pushes the node away from other cluster centers,
   * keeping mission_run clusters spatially separated.
   *
   * @param nodeId - ID of the node to calculate force for
   * @param position - Current position of the node
   * @param strength - Repulsion strength multiplier
   * @returns Force vector to apply to the node
   */
  getInterClusterRepulsionForce(
    nodeId: string,
    position: Vec3,
    strength: number = 1000
  ): Vec3 {
    const force: Vec3 = { x: 0, y: 0, z: 0 };

    if (this.clusters.size <= 1) {
      // No inter-cluster forces needed with 0 or 1 cluster
      return force;
    }

    const nodeClusterId = this.getClusterForNode(nodeId);
    if (!nodeClusterId) return force;

    const MIN_CLUSTER_DISTANCE = 200;

    // Apply repulsion from other cluster centers
    for (const cluster of Array.from(this.clusters.values())) {
      if (cluster.id === nodeClusterId) continue;

      // Vector from other cluster center to node
      const dx = position.x - cluster.center.x;
      const dy = position.y - cluster.center.y;
      const dz = position.z - cluster.center.z;

      const distSq = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(distSq);

      // Skip if very far apart (optimization)
      if (dist > 1000) continue;

      // Calculate repulsion force (stronger when clusters are close)
      const effectiveDistance = Math.max(dist, MIN_CLUSTER_DISTANCE);
      const repulsionForce = strength / (effectiveDistance * effectiveDistance);

      // Normalize direction and apply force
      if (dist > 0.1) {
        force.x += (dx / dist) * repulsionForce;
        force.y += (dy / dist) * repulsionForce;
        force.z += (dz / dist) * repulsionForce;
      }
    }

    return force;
  }

  /**
   * Apply inter-cluster repulsion forces to keep clusters separated.
   *
   * Algorithm:
   * 1. For each node, identify its cluster
   * 2. Calculate repulsion force from other cluster centers
   * 3. Apply force to node velocity (inversely proportional to distance squared)
   *
   * This creates natural spacing between mission_run clusters while allowing
   * intra-cluster forces to organize internal structure.
   *
   * @param nodes - All nodes (will modify velocity in place)
   */
  applyClusterForces(nodes: Node3D[]): void {
    if (this.clusters.size <= 1) {
      // No inter-cluster forces needed with 0 or 1 cluster
      return;
    }

    // Cluster repulsion strength (tune this for desired spacing)
    const CLUSTER_REPULSION = 5000;
    const MIN_CLUSTER_DISTANCE = 200; // Minimum distance between cluster centers

    // Build array of cluster centers for efficient iteration
    const clusterCenters: Array<{ id: string; center: Vec3; radius: number }> =
      [];
    for (const cluster of Array.from(this.clusters.values())) {
      clusterCenters.push({
        id: cluster.id,
        center: cluster.center,
        radius: cluster.radius,
      });
    }

    // Apply repulsion forces
    for (const node of nodes) {
      const nodeClusterId = this.getClusterForNode(node.id);
      if (!nodeClusterId) continue;

      const nodeCluster = this.clusters.get(nodeClusterId);
      if (!nodeCluster) continue;

      // Apply repulsion from other cluster centers
      for (const otherCluster of clusterCenters) {
        if (otherCluster.id === nodeClusterId) continue;

        // Vector from other cluster center to node
        const dx = node.position.x - otherCluster.center.x;
        const dy = node.position.y - otherCluster.center.y;
        const dz = node.position.z - otherCluster.center.z;

        const distSq = dx * dx + dy * dy + dz * dz;
        const dist = Math.sqrt(distSq);

        // Skip if very far apart (optimization)
        if (dist > 1000) continue;

        // Calculate repulsion force (stronger when clusters are close)
        const effectiveDistance = Math.max(dist, MIN_CLUSTER_DISTANCE);
        const force = CLUSTER_REPULSION / (effectiveDistance * effectiveDistance);

        // Normalize direction and apply force
        if (dist > 0.1) {
          const normX = dx / dist;
          const normY = dy / dist;
          const normZ = dz / dist;

          node.velocity.x += normX * force;
          node.velocity.y += normY * force;
          node.velocity.z += normZ * force;
        }
      }
    }
  }

  /**
   * Get all clusters.
   *
   * @returns Map of cluster ID to Cluster object
   */
  getClusters(): Map<string, Cluster> {
    return new Map(this.clusters);
  }

  /**
   * Get cluster by ID.
   *
   * @param clusterId - ID of the cluster
   * @returns Cluster object or undefined if not found
   */
  getCluster(clusterId: string): Cluster | undefined {
    return this.clusters.get(clusterId);
  }

  /**
   * Get statistics about current clustering state.
   *
   * @returns Object with cluster statistics
   */
  getStats(): {
    clusterCount: number;
    nodeCount: number;
    averageClusterSize: number;
    focusedCluster: string | null;
  } {
    let totalNodes = 0;
    for (const cluster of Array.from(this.clusters.values())) {
      totalNodes += cluster.nodeIds.size;
    }

    return {
      clusterCount: this.clusters.size,
      nodeCount: totalNodes,
      averageClusterSize:
        this.clusters.size > 0 ? totalNodes / this.clusters.size : 0,
      focusedCluster: this.focusedClusterId,
    };
  }
}
