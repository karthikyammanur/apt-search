import ts from "typescript";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
mkdirSync(path.join(root, "dist"), { recursive: true });
for (const name of ["capture", "parser", "popup", "options"]) {
  const source = readFileSync(path.join(root, `${name}.ts`), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  writeFileSync(path.join(root, "dist", `${name}.js`), result.outputText);
}
for (const name of ["manifest.json", "popup.html", "options.html", "style.css"])
  copyFileSync(path.join(root, name), path.join(root, "dist", name));
console.log("Extension built in extension/dist. Load that folder unpacked in Chrome.");
