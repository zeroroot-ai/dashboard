/**
 * /dashboard/docs index, overview of the mission DSL with
 * pointers to verbs / nouns / schema-reference / templates.
 */

import Link from "next/link";

export default function DocsIndex() {
  return (
    <>
      <h1>Mission DSL Reference</h1>
      <p className="lead">
        Generated from the SDK's mission protos at every release tag.
        Use the sidebar to navigate; the four catalog pages cover
        every verb the orchestrator can pick, every node type the
        DAG can express, every field on every mission message, and
        every template the ADK ships.
      </p>
      <ul>
        <li>
          <Link href="/dashboard/docs/verbs">Mission Verbs</Link>, the
          12 decision actions the orchestrator can take.
        </li>
        <li>
          <Link href="/dashboard/docs/nouns">Mission Nouns</Link> -
          every <code>NodeType</code> with its config message and
          MergeStrategy.
        </li>
        <li>
          <Link href="/dashboard/docs/schema-reference">
            Schema Reference
          </Link>{" "}
         , exhaustive field reference for every mission proto
          message.
        </li>
        <li>
          <Link href="/dashboard/docs/templates">Templates</Link> -
          ready-to-use missions shipped by the ADK.
        </li>
      </ul>
      <p>
        Every term in these pages is sourced from the canonical proto
        comments, no hand-written documentation. The dashboard&rsquo;s{" "}
        <code>scripts/vendor-mission-authoring-bundle.mjs</code>{" "}
        prebuild step refreshes this content from the OCI bundle on
        every SDK tag bump.
      </p>
    </>
  );
}
