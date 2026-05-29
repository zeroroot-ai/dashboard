/**
 * Default CUE source for a brand-new mission.
 *
 * Loaded into the editor when the user clicks "New Mission". Unlike the old
 * three-field stub, this is a complete, schema-bound mission that compiles
 * cleanly via ValidateMissionCUE — so the Run button is enabled the moment the
 * editor opens. It mirrors the structure of the shipped single-node templates
 * (e.g. secrets-audit), which the daemon already validates as known-good, so
 * "validates clean on a fresh mission" holds by construction.
 *
 * The author fills in `targetRef` (and tunes the node) before running.
 *
 * dashboard#492 (D1).
 */
export const NEW_MISSION_CUE = `// Gibson Mission Definition (CUE)
//
// A mission orchestrates one or more agents against a target. Inline
// diagnostics appear as you type; Run stays disabled until the definition
// compiles cleanly.
//
// Before running, set targetRef to the target you want to assess. Add nodes
// and edges to build a multi-step pipeline.

import missionv1 "github.com/zeroroot-ai/sdk/api/proto/gibson/mission/v1"

mission: missionv1.#MissionDefinition & {
\tname:        "new-mission"
\tdescription: "Describe what this mission should accomplish."
\tversion:     "0.1.0"
\ttargetRef:   ""

\tnodes: {
\t\tassess: {
\t\t\tid:   "assess"
\t\t\ttype: missionv1.#NODE_TYPE_AGENT
\t\t\tagentConfig: {
\t\t\t\tagentName: "recon-agent"
\t\t\t}
\t\t}
\t}
\tentryPoints: ["assess"]
\texitPoints: ["assess"]
}
`;
