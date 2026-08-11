import { Metadata } from "next";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function generateAvatarFallback(string: string) {
  const names = string.split(" ").filter((name: string) => name);
  const mapped = names.map((name: string) => name.charAt(0).toUpperCase());

  return mapped.join("");
}

export function generateMeta({
  title,
  additionalTitle = false,
  description,
  canonical
}: {
  title: string;
  additionalTitle?: boolean;
  description: string;
  canonical: string;
}): Metadata {
  return {
    title: `${title}, Zero Root AI`,
    description: description,
    // Server env, read at request time — the same app-origin source the
    // host-split middleware uses. The old NEXT_PUBLIC_APP_URL was set by no
    // environment (inlined undefined at build), so staging pages advertised
    // prod canonical/OG URLs (dashboard#1036).
    metadataBase: new URL(
      process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? 'https://app.zeroroot.ai',
    ),
    alternates: {
      canonical: `/dashboard${canonical}`
    },
    openGraph: {
      images: [`/images/seo.jpg`]
    }
  };
}

// a function to get the first letter of the first and last name of names
const getInitials = (fullName: string) => {
  const nameParts = fullName.split(" ");
  const firstNameInitial = nameParts[0].charAt(0).toUpperCase();
  const lastNameInitial = nameParts[1].charAt(0).toUpperCase();
  return `${firstNameInitial}${lastNameInitial}`;
};
