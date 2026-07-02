(function () {
  var isEmbedded = window.parent && window.parent !== window;

  var injectedStyle = null;
  if (isEmbedded) {
    injectedStyle = document.createElement("style");
    injectedStyle.setAttribute("data-iframe-fix", "");
    injectedStyle.textContent =
      ".min-h-svh { min-height: fit-content !important; } .min-h-screen { min-height: fit-content !important; }";
    document.head.appendChild(injectedStyle);
  }

  var sendHeight = function () {
    if (isEmbedded) {
      var height = document.body.offsetHeight;
      window.parent.postMessage({ type: "iframe-height", height: height }, "*");
    }
  };

  var readySent = false;
  var notifyReady = function () {
    if (readySent || !isEmbedded) return;
    readySent = true;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.parent.postMessage({ type: "iframe-ready" }, "*");
        sendHeight();
      });
    });
  };

  var readyFallback = setTimeout(notifyReady, 3000);

  var ro = new ResizeObserver(sendHeight);
  ro.observe(document.body);

  document.addEventListener(
    "wheel",
    function (e) {
      if (isEmbedded) {
        e.preventDefault();
        window.parent.postMessage(
          {
            type: "iframe-wheel",
            deltaX: e.deltaX,
            deltaY: e.deltaY,
            deltaMode: e.deltaMode,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
          },
          "*"
        );
      }
    },
    { passive: false }
  );

  var notifyLoading = function () {
    if (isEmbedded) {
      window.parent.postMessage({ type: "iframe-loading" }, "*");
    }
  };

  if (document.readyState === "complete") {
    setTimeout(notifyLoading, 200);
  } else {
    window.addEventListener("load", function () {
      setTimeout(notifyLoading, 200);
    });
  }

  var googleFonts = {
    Inter: "Inter",
    Roboto: "Roboto",
    Poppins: "Poppins",
    Nunito: "Nunito",
    "DM Sans": "DM Sans",
  };

  var shadowScales = {
    none: {
      "--shadow-2xs": "0 0 #0000",
      "--shadow-xs": "0 0 #0000",
      "--shadow-sm": "0 0 #0000",
      "--shadow-md": "0 0 #0000",
      "--shadow-lg": "0 0 #0000",
      "--shadow-xl": "0 0 #0000",
      "--shadow-2xl": "0 0 #0000",
    },
    sm: {
      "--shadow-2xs": "0 1px rgb(0 0 0 / 0.02)",
      "--shadow-xs": "0 1px 2px rgb(0 0 0 / 0.03)",
      "--shadow-sm": "0 1px 2px rgb(0 0 0 / 0.05), 0 1px 1px -1px rgb(0 0 0 / 0.04)",
      "--shadow-md": "0 3px 5px -1px rgb(0 0 0 / 0.06), 0 1px 3px -1px rgb(0 0 0 / 0.05)",
      "--shadow-lg": "0 6px 10px -2px rgb(0 0 0 / 0.06), 0 3px 5px -2px rgb(0 0 0 / 0.05)",
      "--shadow-xl": "0 12px 18px -4px rgb(0 0 0 / 0.06), 0 5px 8px -3px rgb(0 0 0 / 0.05)",
      "--shadow-2xl": "0 16px 30px -8px rgb(0 0 0 / 0.15)",
    },
    md: {
      "--shadow-2xs": "0 1px 2px rgb(0 0 0 / 0.04)",
      "--shadow-xs": "0 1px 3px rgb(0 0 0 / 0.06)",
      "--shadow-sm": "0 1px 4px rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
      "--shadow-md": "0 4px 8px -2px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.08)",
      "--shadow-lg": "0 10px 16px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.08)",
      "--shadow-xl": "0 18px 28px -5px rgb(0 0 0 / 0.12), 0 8px 12px -5px rgb(0 0 0 / 0.08)",
      "--shadow-2xl": "0 24px 48px -12px rgb(0 0 0 / 0.25)",
    },
    lg: {
      "--shadow-2xs": "0 1px 2px rgb(0 0 0 / 0.08)",
      "--shadow-xs": "0 2px 4px rgb(0 0 0 / 0.1)",
      "--shadow-sm": "0 2px 6px rgb(0 0 0 / 0.14), 0 1px 3px -1px rgb(0 0 0 / 0.12)",
      "--shadow-md": "0 6px 12px -2px rgb(0 0 0 / 0.15), 0 3px 6px -2px rgb(0 0 0 / 0.12)",
      "--shadow-lg": "0 14px 22px -4px rgb(0 0 0 / 0.16), 0 6px 10px -4px rgb(0 0 0 / 0.12)",
      "--shadow-xl": "0 24px 36px -6px rgb(0 0 0 / 0.18), 0 10px 16px -6px rgb(0 0 0 / 0.12)",
      "--shadow-2xl": "0 32px 64px -16px rgb(0 0 0 / 0.35)",
    },
    xl: {
      "--shadow-2xs": "0 1px 3px rgb(0 0 0 / 0.12)",
      "--shadow-xs": "0 2px 6px rgb(0 0 0 / 0.15)",
      "--shadow-sm": "0 3px 8px rgb(0 0 0 / 0.2), 0 2px 4px -1px rgb(0 0 0 / 0.15)",
      "--shadow-md": "0 8px 16px -3px rgb(0 0 0 / 0.22), 0 4px 8px -4px rgb(0 0 0 / 0.15)",
      "--shadow-lg": "0 20px 30px -6px rgb(0 0 0 / 0.22), 0 8px 14px -6px rgb(0 0 0 / 0.16)",
      "--shadow-xl": "0 32px 48px -8px rgb(0 0 0 / 0.25), 0 14px 20px -8px rgb(0 0 0 / 0.16)",
      "--shadow-2xl": "0 40px 80px -20px rgb(0 0 0 / 0.45)",
    },
  };

  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "theme") {
      var isDark = e.data.value === "dark";
      document.documentElement.classList.toggle("dark", isDark);
    }

    if (e.data && e.data.type === "theme-colors") {
      var colors = e.data.colors;
      var root = document.documentElement;
      Object.entries(colors).forEach(function (entry) {
        if (entry[1]) root.style.setProperty(entry[0], entry[1]);
      });
    }

    if (e.data && e.data.type === "theme-typography") {
      var typography = e.data.typography;
      var root = document.documentElement;
      var body = document.body;

      if (typography.fontFamily === "sans") {
        root.style.removeProperty("font-family");
        body.style.removeProperty("font-family");
      } else if (typography.fontFamily === "serif") {
        var v = "ui-serif, Georgia, Cambria, 'Times New Roman', serif";
        root.style.setProperty("font-family", v);
        body.style.setProperty("font-family", v);
      } else if (typography.fontFamily === "mono") {
        var v = "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace";
        root.style.setProperty("font-family", v);
        body.style.setProperty("font-family", v);
      } else if (googleFonts[typography.fontFamily]) {
        var fontName = googleFonts[typography.fontFamily];
        var linkId = "gf-" + fontName.replace(/\s+/g, "-");
        if (!document.getElementById(linkId)) {
          var link = document.createElement("link");
          link.id = linkId;
          link.rel = "stylesheet";
          link.href =
            "https://fonts.googleapis.com/css2?family=" +
            encodeURIComponent(fontName) +
            ":wght@300;400;500;600;700&display=swap";
          document.head.appendChild(link);
        }
        var v = "'" + fontName + "', ui-sans-serif, system-ui, sans-serif";
        root.style.setProperty("font-family", v);
        body.style.setProperty("font-family", v);
      }

      if (typography.fontSizeBase) root.style.setProperty("font-size", typography.fontSizeBase);
      if (typography.lineHeight) {
        root.style.setProperty("line-height", typography.lineHeight);
        body.style.setProperty("line-height", typography.lineHeight);
      }
      if (typography.fontWeightNormal)
        root.style.setProperty("--font-weight-normal", typography.fontWeightNormal);
      if (typography.fontWeightBold)
        root.style.setProperty("--font-weight-bold", typography.fontWeightBold);
    }

    if (e.data && e.data.type === "theme-spacing") {
      var spacing = e.data.spacing;
      if (spacing.baseSpacingUnit)
        document.documentElement.style.setProperty("--spacing", spacing.baseSpacingUnit);
    }

    if (e.data && e.data.type === "theme-others") {
      var others = e.data.others;
      var root = document.documentElement;

      if (others.radius) root.style.setProperty("--radius", others.radius);

      if (others.shadow) {
        var scale = shadowScales[others.shadow];
        if (scale) {
          Object.entries(scale).forEach(function (entry) {
            root.style.setProperty(entry[0], entry[1]);
          });
        } else {
          ["--shadow-2xs", "--shadow-xs", "--shadow-sm", "--shadow-md", "--shadow-lg", "--shadow-xl", "--shadow-2xl"].forEach(function (v) {
            root.style.removeProperty(v);
          });
        }
      }

      clearTimeout(readyFallback);
      notifyReady();
    }
  });
})();
