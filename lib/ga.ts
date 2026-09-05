"use client";

import { useEffect } from "react";
import ReactGA from "react-ga4";

let gaWarned = false;

export default function GoogleAnalyticsInit() {
  useEffect(() => {
    const GA_KEY = process.env.NEXT_PUBLIC_GA_KEY;

    if (!GA_KEY) {
      if (!gaWarned) {
        gaWarned = true;
        console.error("Google Analytics key not provided.");
      }
      return;
    }

    ReactGA.initialize(GA_KEY);
    ReactGA.send("pageview");
  });

  return null;
}
