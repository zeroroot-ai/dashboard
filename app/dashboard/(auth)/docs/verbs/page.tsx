import { loadDocPage, MarkdownBody } from "../_lib/render-mdx";

export default function VerbsPage() {
  const doc = loadDocPage("verbs");
  return (
    <>
      {doc.title ? <h1>{doc.title}</h1> : null}
      {doc.description ? <p className="lead">{doc.description}</p> : null}
      <MarkdownBody body={doc.body} />
    </>
  );
}
