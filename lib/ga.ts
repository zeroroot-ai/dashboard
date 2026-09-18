// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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
    // Once per mount. Without the dependency array this effect ran on every
    // render of the root layout, re-initialised the tracker and sent a
    // pageview each time.
  }, []);

  return null;
}
