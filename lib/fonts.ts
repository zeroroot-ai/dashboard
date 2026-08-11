import {
  Geist,
  Inter,
  JetBrains_Mono,
  Overpass_Mono,
  Poppins,
  Roboto,
  PT_Sans,
  Plus_Jakarta_Sans,
  Hedvig_Letters_Serif,
  Kumbh_Sans,
  Outfit
} from "next/font/google";
import localFont from "next/font/local";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto"
});

const plus_jakarta_sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-plus-jakarta-sans"
});

// Self-hosted rather than next/font/google: the image build fetches
// next/font/google assets from fonts.gstatic.com at build time, and a
// transient 404 there hard-fails the Docker build with an error that names
// neither fonts nor the network (dashboard#1029). The woff2 files below are
// vendored from @fontsource/montserrat 5.3.0 (npm registry, latin subset,
// normal style, SIL Open Font License, see ./fonts/montserrat/LICENSE), so
// the build no longer depends on a third-party CDN returning 200 for five
// specific hashed asset URLs.
const montserrat = localFont({
  src: [
    { path: "./fonts/montserrat/montserrat-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/montserrat/montserrat-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/montserrat/montserrat-latin-600-normal.woff2", weight: "600", style: "normal" }
  ],
  variable: "--font-montserrat",
  display: "swap"
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-poppins"
});

const overpass_mono = Overpass_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-overpass-mono"
});

const ptSans = PT_Sans({
  variable: "--font-pt-sans",
  subsets: ["latin"],
  weight: ["400", "700"]
});

const hedvig_letters_serif = Hedvig_Letters_Serif({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-hedvig-letters-serif"
});

const kumbh_sans = Kumbh_Sans({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-kumbh-sans"
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-outfit"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap"
});

export const fontVariables = cn(
  geist.variable,
  inter.variable,
  roboto.variable,
  montserrat.variable,
  poppins.variable,
  overpass_mono.variable,
  ptSans.variable,
  plus_jakarta_sans.variable,
  hedvig_letters_serif.variable,
  kumbh_sans.variable,
  outfit.variable,
  jetbrainsMono.variable
);
