// Runtime patch for monthly mutual-fund quantity-change support.
// Keeps server.js intact while extending its existing portfolio parser.
const Module = require("module");
const fs = require("fs");
const originalLoader = Module._extensions[".js"];

Module._extensions[".js"] = function(module, filename) {
  if (!filename.endsWith("/server.js") && !filename.endsWith("\\server.js")) {
    return originalLoader(module, filename);
  }

  let source = fs.readFileSync(filename, "utf8");

  const helper = `\nfunction parseHoldingQuantity(text) {\n  const s = String(text || "").replace(/,/g, "").replace(/\\s+/g, " ").trim();\n  if (!s || s === "-" || /^n\\/a$/i.test(s)) return null;\n  const m = s.match(/[-+]?\\(?\\d+(?:\\.\\d+)?\\)?/);\n  if (!m) return null;\n  const raw = m[0];\n  const n = Number(raw.replace(/[()]/g, ""));\n  if (!Number.isFinite(n)) return null;\n  return raw.includes("(") ? -n : n;\n}\n`;

  if (!source.includes("function parseHoldingQuantity(")) {
    source = source.replace("function parseMfiTopHoldings(html) {", helper + "\nfunction parseMfiTopHoldings(html) {");
  }

  const anchor = `    const currentAllocation = change.includes("exited") ? 0 : allocation;\n    const previousAllocation =\n      Number.isFinite(delta) ? Math.max(0, currentAllocation - delta) : null;`;
  const injected = `${anchor}\n\n    // Quantity is available on sources exposing the portfolio quantity / month-on-month quantity columns.\n    // MFI Top-10 factsheets generally expose allocation only, so quantity remains unavailable there.\n    let quantity = null;\n    let previousQuantity = null;\n    if (allocIndex >= 5 && cells.length >= 6) {\n      quantity = parseHoldingQuantity(cells[3]);\n      const quantityDelta = parseHoldingQuantity(cells[4]);\n      if (change.includes("exited")) {\n        previousQuantity = Number.isFinite(quantity) ? quantity : null;\n        quantity = 0;\n      } else if (Number.isFinite(quantity) && Number.isFinite(quantityDelta)) {\n        previousQuantity = Math.max(0, quantity - quantityDelta);\n      } else if (change.includes("new") && Number.isFinite(quantity)) {\n        previousQuantity = 0;\n      }\n    }`;
  if (source.includes(anchor) && !source.includes("let quantity = null;")) source = source.replace(anchor, injected);

  const rowAnchor = `      deltaAllocation: delta,\n      changeType: change,\n      asOf: portfolioAsOf,`;
  const rowReplacement = `      deltaAllocation: delta,\n      quantity,\n      previousQuantity,\n      changeType: change,\n      asOf: portfolioAsOf,`;
  if (source.includes(rowAnchor)) source = source.replace(rowAnchor, rowReplacement);

  const itemAnchor = `        previousAllocation: Number.isFinite(h.previousAllocation) ? h.previousAllocation : null,\n        changeType: h.changeType || "",\n        asOf: h.asOf || rec.asOf || null`;
  const itemReplacement = `        previousAllocation: Number.isFinite(h.previousAllocation) ? h.previousAllocation : null,\n        quantity: Number.isFinite(h.quantity) ? h.quantity : null,\n        previousQuantity: Number.isFinite(h.previousQuantity) ? h.previousQuantity : null,\n        changeType: h.changeType || "",\n        asOf: h.asOf || rec.asOf || null,\n        source: rec.source || ""`;
  if (source.includes(itemAnchor)) source = source.replace(itemAnchor, itemReplacement);

  const aggregateAnchor = `    const holdingsAsOf = tracked.map(x=>x.asOf).find(Boolean) || null;`;
  const aggregateReplacement = `${aggregateAnchor}\n    // Sum reported share-count changes only where both month-end quantities are available.\n    // This is a quantity comparison, not a rupee-value change and is not affected by price movement.\n    // It remains a portfolio-snapshot comparison, not transaction-level trade data.\n    const quantityTracked = tracked.filter(x => Number.isFinite(x.quantity) && Number.isFinite(x.previousQuantity));\n    const quantityDelta = quantityTracked.length\n      ? quantityTracked.reduce((s,x) => s + (x.quantity - x.previousQuantity), 0)\n      : null;\n    const quantityDeltaFunds = quantityTracked.length;\n    const holdingsSource = tracked.map(x=>x.source).find(Boolean) || null;`;
  if (source.includes(aggregateAnchor) && !source.includes("const quantityTracked = tracked.filter")) source = source.replace(aggregateAnchor, aggregateReplacement);

  const outputAnchor = `      fundsExited,\n      holdingsAsOf,`;
  const outputReplacement = `      fundsExited,\n      quantityDelta,\n      quantityDeltaFunds,\n      holdingsAsOf,\n      holdingsSource,`;
  if (source.includes(outputAnchor) && !source.includes("      quantityDelta,\n      quantityDeltaFunds,")) source = source.replace(outputAnchor, outputReplacement);

  const fundOutputAnchor = `        fund:x.fund, category:x.category, allocation:x.allocation,\n        previousAllocation:x.previousAllocation, changeType:x.changeType, asOf:x.asOf`;
  const fundOutputReplacement = `        fund:x.fund, category:x.category, allocation:x.allocation,\n        previousAllocation:x.previousAllocation, quantity:x.quantity, previousQuantity:x.previousQuantity,\n        changeType:x.changeType, asOf:x.asOf, source:x.source`;
  source = source.replaceAll(fundOutputAnchor, fundOutputReplacement);

  module._compile(source, filename);
};
