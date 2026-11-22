// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { groupByToolClass, toolClassLabel } from "../tool-class";
import type { CatalogEntryDTO, ConnectorDTO } from "../connector-types";

const entry = (id: string, toolClass: string): CatalogEntryDTO => ({
  id,
  displayName: id,
  description: "",
  shape: "Hosted",
  auth: "none",
  defaultInstanceUrl: "",
  toolClass,
});

const conn = (id: string): ConnectorDTO => ({
  id,
  shape: "Hosted",
  runtime: "hosted",
  phase: "Ready",
  discoveredTools: 0,
  lastError: "",
});

describe("groupByToolClass", () => {
  const catalog = [entry("splunk", "siem"), entry("sentinel", "siem"), entry("crowdstrike", "edr"), entry("odd", "")];

  it("puts each connector under the tool class of its catalog entry", () => {
    const g = groupByToolClass([conn("crowdstrike"), conn("splunk"), conn("sentinel")], catalog);
    expect(g.map((x) => [x.toolClass, x.connectors.map((c) => c.id)])).toEqual([
      ["edr", ["crowdstrike"]],
      ["siem", ["splunk", "sentinel"]],
    ]);
  });

  it("puts a connector with an empty tool class, or with no catalog entry, under unknown, last", () => {
    const g = groupByToolClass([conn("odd"), conn("gone"), conn("splunk")], catalog);
    expect(g.map((x) => x.toolClass)).toEqual(["siem", ""]);
    expect(g[1].connectors.map((c) => c.id)).toEqual(["odd", "gone"]);
    expect(toolClassLabel("")).toBe("Unknown");
    expect(toolClassLabel("siem")).toBe("siem");
  });

  it("returns no group for no connector", () => {
    expect(groupByToolClass([], catalog)).toEqual([]);
  });
});
