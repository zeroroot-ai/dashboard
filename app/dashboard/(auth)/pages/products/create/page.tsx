import { generateMeta } from "@/lib/utils";
import AddProductForm from "./add-product-form";

export async function generateMetadata() {
  return generateMeta({
    title: "Add Product Page",
    additionalTitle: true,
    description:
      "Add Product Page for shadcn/ui built with React, TypeScript, Tailwind CSS, and Zod. Optimize your e-commerce dashboard with step-by-step forms and media upload components.",
    canonical: "/pages/products/create"
  });
}

export default function Page() {
  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <AddProductForm />
    </div>
  );
}
