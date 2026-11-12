// usage: node extract-command-builders.mjs <the driver's unpacked archive (package/)> <typescript module dir> <out file>
//          --commit <the tag's commit> --archive-url <url> --archive-sha256 <hex>
// THE PROVENANCE OF spec/command-builders.json (Creating a pack, step 2: a table read from a client's source by a
// program keeps that program beside it). Run from the packs repository's root on the archive in spec/clients/:
//   mkdir -p /tmp/mongodb-driver && tar -xzf mongodb/spec/clients/mongodb-6.20.0.tgz -C /tmp/mongodb-driver
//   node mongodb/spec/extract-command-builders.mjs /tmp/mongodb-driver/package node_modules/typescript mongodb/spec/command-builders.json \
//     --commit 477140e932062586f4598677648a562e75f19657 --archive-url https://registry.npmjs.org/mongodb/-/mongodb-6.20.0.tgz \
//     --archive-sha256 a12bd599cb4f39cdf222b32380ea3efd1f60c6d88615e0700632a303a9006b02
// The same archive in gives the same file out, byte for byte.
// The command table of MongoDB as its own Node driver builds it: for every command document the driver's operations
// construct, the command's name, each field it can carry, the field's declared type, and the condition under which
// the driver sends it. Read from the driver's syntax tree with the TypeScript compiler; nothing of the driver is
// executed. A construct this reader cannot attribute is an error naming the file and line, never a silent hole.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [checkout, typescriptDir, outFile] = process.argv.slice(2);
const flag = (name) => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : undefined; };
if (!checkout || !typescriptDir || !outFile || !flag("--commit") || !flag("--archive-url") || !/^[0-9a-f]{64}$/.test(flag("--archive-sha256") ?? "")) { console.error("usage: node extract-command-builders.mjs <driver package dir> <typescript module dir> <out file> --commit <sha> --archive-url <url> --archive-sha256 <hex>"); process.exit(2); }
const ts = createRequire(import.meta.url)(path.resolve(typescriptDir));
const operations = path.join(checkout, "src", "operations");
// What is not a server's command table, each with its why (printed with the result).
const NOT_READ = {
  "run_command.ts": "the document is the caller's own; there is no table to read",
  "search_indexes/create.ts": "Atlas Search, not a server a World runs", "search_indexes/drop.ts": "Atlas Search", "search_indexes/update.ts": "Atlas Search",
  "client_bulk_write/client_bulk_write.ts": "the bulkWrite command of server 8.0, built by a separate builder; absent on the 7.0 oracle",
  "execute_operation.ts": "runs operations; builds no command", "operation.ts": "the base of every operation; builds no command",
};
const files = [];
const walk = (dir, at = "") => { for (const entry of fs.readdirSync(path.join(dir, at), { withFileTypes: true })) { if (entry.isDirectory()) walk(dir, path.join(at, entry.name)); else if (entry.name.endsWith(".ts")) files.push(path.join(at, entry.name)); } };
walk(operations);
// The envelope: what the layers below the operations add to every command document, whatever the command.
const ENVELOPE = [
  { file: "src/cmap/connection.ts", function: "prepareCommand", document: "cmd", layer: "the connection" },
  { file: "src/sessions.ts", function: "applySession", document: "command", layer: "the session" },
  { file: "src/cmap/commands.ts", function: "constructor", inClass: "OpMsgRequest", document: "this.command", layer: "the message" },
];
const program = ts.createProgram([...files.map((file) => path.join(operations, file)), ...ENVELOPE.map((one) => path.join(checkout, one.file))], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, allowJs: false, types: [] });
const checker = program.getTypeChecker();
const where = (node) => { const source = node.getSourceFile(), { line } = source.getLineAndCharacterOfPosition(node.getStart()); return { file: "src/operations/" + path.relative(operations, source.fileName), line: line + 1 }; };
const fail = (node, message) => { const at = where(node); throw new Error(`${at.file}:${at.line}: ${message}`); };
const textOf = (node) => node.getText().replace(/\s+/g, " ");

/** The conditions a statement runs under, innermost last, up to its function. */
function conditions(node, boundary) {
  const held = [];
  for (let child = node, parent = node.parent; parent && child !== boundary; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent)) { if (parent.thenStatement === child) held.unshift(textOf(parent.expression)); else if (parent.elseStatement === child) held.unshift(`!(${textOf(parent.expression)})`); }
    else if (ts.isConditionalExpression(parent)) { if (parent.whenTrue === child) held.unshift(textOf(parent.condition)); else if (parent.whenFalse === child) held.unshift(`!(${textOf(parent.condition)})`); }
  }
  return held;
}
/** How a condition is classed, without evaluating it. */
function classify(held, optionNames) {
  if (!held.length) return { form: "always" };
  const text = held.join(" && ");
  const wire = /maxWireVersion\([^)]*\)\s*(>=|<|>|<=)\s*([A-Z_0-9]+|\d+)/.exec(text);
  if (wire) return { form: "wire-version", text };
  // only the option itself is tested: every identifier chain in the condition is options.<name> or this.options.<name>
  const stripped = text.replace(/(this\.)?options\??\.[A-Za-z_]+/g, "").replace(/typeof|null|undefined|true|false|'[a-z]+'|"[a-z]+"|[!=<>&|()?\s]|\d+/g, "");
  if (stripped === "" && optionNames.length) return { form: "given", text };
  return { form: "other", text };
}
const optionsRead = (node) => { const names = new Set(); const visit = (n) => { if (ts.isPropertyAccessExpression(n) && /^(this\.)?options$/.test(n.expression.getText())) names.add(n.name.text); ts.forEachChild(n, visit); }; visit(node); return [...names]; };
/** The declared type of options.<name>, as the driver's own interface writes it. */
function declaredType(expression) {
  let found;
  const visit = (n) => { if (!found && ts.isPropertyAccessExpression(n) && /^(this\.)?options$/.test(n.expression.getText())) found = n; if (!found) ts.forEachChild(n, visit); };
  visit(expression);
  if (!found) return { type: checker.typeToString(checker.getTypeAtLocation(expression), undefined, ts.TypeFormatFlags.NoTruncation), from: "the expression" };
  const symbol = checker.getSymbolAtLocation(found.name), declaration = symbol?.declarations?.[0];
  if (declaration && (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) && declaration.type) return { type: textOf(declaration.type), from: `${declaration.parent.name?.text ?? "?"}.${found.name.text}`, optional: Boolean(declaration.questionToken) };
  return { type: checker.typeToString(checker.getTypeAtLocation(found), undefined, ts.TypeFormatFlags.NoTruncation), from: `options.${found.name.text}` };
}

const table = new Map(), notes = [], skipped = [];
/** Reads one builder: a function or method whose result is a command (or statement) document. */
function readBuilder(fn, label, source, preset = []) {
  const fields = new Map(); let name, begins;
  const add = (fieldName, valueNode, at, extra = {}) => {
    const held = conditions(at, fn), read = valueNode ? optionsRead(valueNode) : [], condition = classify(held, [...read, ...held.flatMap((text) => [...text.matchAll(/options\??\.([A-Za-z_]+)/g)].map((m) => m[1]))]);
    const type = valueNode ? declaredType(valueNode) : { type: "unknown", from: "no value" };
    const entry = { name: fieldName, type: type.type, typeFrom: type.from, ...(valueNode ? { value: textOf(valueNode).slice(0, 120) } : {}), ...(type.optional ? { optional: true } : {}), sentWhen: condition, source: where(at), ...extra };
    const before = fields.get(fieldName);
    if (!before) fields.set(fieldName, entry); else (before.also ??= []).push({ sentWhen: condition, source: entry.source });
  };
  const documents = new Set(preset);
  const literal = (object, first) => {
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
        const key = property.name.getText().replace(/^['"]|['"]$/g, "");
        if (first && name === undefined) name = key;
        add(key, ts.isPropertyAssignment(property) ? property.initializer : property.name, property);
      } else if (ts.isSpreadAssignment(property)) spread(property);
      else fail(property, `a property of a kind this reader does not follow in ${label}`);
    }
  };
  /** A spread: the options copied through a literal Set (Form B), a conditional object, or another builder's result. */
  const spread = (property) => {
    const text = textOf(property.expression);
    const set = /Object\.fromEntries\(\s*Object\.entries\((this\.)?options\)\.filter\((\w+)\)\s*\)/.exec(text);
    if (set) {
      const illegal = setLiteral(source, /!([A-Z_]+)\.has\(/.exec(fn.getText())?.[1]);
      if (!illegal) fail(property, "options copied through a filter whose Set this reader could not read");
      const optionsType = checker.getTypeAtLocation(findOptions(fn));
      for (const symbol of checker.getPropertiesOfType(optionsType)) {
        if (illegal.names.has(symbol.name)) continue;
        const declaration = symbol.declarations?.[0];
        fields.set(symbol.name, { name: symbol.name, type: declaration?.type ? textOf(declaration.type) : "unknown", typeFrom: `${declaration?.parent?.name?.text ?? "?"}.${symbol.name}`, optional: true, sentWhen: { form: "given", text: `every option except ${illegal.set} (${illegal.names.size} names)` }, source: where(property) });
      }
      return;
    }
    const inline = /Object\.fromEntries\(\s*Object\.entries\((this\.)?options\)\.filter\(\s*(\w+)\s*=>\s*\2\[0\]\s*!==\s*'(\w+)'\s*\)\s*\)/.exec(text);
    if (inline) {
      for (const symbol of checker.getPropertiesOfType(checker.getTypeAtLocation(findOptions(fn)))) {
        if (symbol.name === inline[3]) continue;
        const declaration = symbol.declarations?.[0];
        fields.set(symbol.name, { name: symbol.name, type: declaration?.type ? textOf(declaration.type) : "unknown", typeFrom: `${declaration?.parent?.name?.text ?? "?"}.${symbol.name}`, optional: true, sentWhen: { form: "given", text: `every option except ${inline[3]}` }, source: where(property) });
      }
      return;
    }
    if (ts.isParenthesizedExpression(property.expression) || ts.isConditionalExpression(property.expression) || ts.isBinaryExpression(property.expression)) {
      const inner = []; const visit = (n) => { if (ts.isObjectLiteralExpression(n)) inner.push(n); else ts.forEachChild(n, visit); }; visit(property.expression);
      for (const object of inner) for (const p of object.properties) { if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) fail(p, "a nested spread"); add(p.name.getText(), ts.isPropertyAssignment(p) ? p.initializer : p.name, p, { spreadUnder: text.slice(0, 120) }); }
      return;
    }
    notes.push({ ...where(property), builder: label, note: `spreads ${text.slice(0, 80)}: not followed` });
  };
  const visit = (node) => {
    if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node))) return;
    // const X: Document = { ... }  — the document being built
    // (not in the envelope's functions: there the document is the one named, and other literals are the layer's own options)
    if (!preset.length && ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer) && /command|cmd|statement|op\b|^op$/i.test(node.name.getText())) { documents.add(node.name.getText()); literal(node.initializer, true); return; }
    if (!preset.length && ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) { literal(node.expression, true); return; }
    // const X = super.buildCommandDocument(…) / this.buildCommandDocument(…): the document begins as another builder's
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && /^(super|this)\.buildCommandDocument$/.test(node.initializer.expression.getText())) { documents.add(node.name.getText()); begins = node.initializer.expression.getText().startsWith("super") ? "the class it extends" : "its own buildCommandDocument"; }
    // WriteConcern.apply(X, …) sets writeConcern
    if (ts.isCallExpression(node) && node.expression.getText() === "WriteConcern.apply" && documents.has(node.arguments[0]?.getText())) add("writeConcern", node.arguments[1], node, { by: "WriteConcern.apply" });
    // helper(X, options): a function of the same file that sets fields on its first parameter
    // (a call whose result is used, in a condition or an assignment, reads the document and sets nothing)
    if (ts.isCallExpression(node) && ts.isExpressionStatement(node.parent) && ts.isIdentifier(node.expression) && node.arguments.length && documents.has(node.arguments[0].getText()) && !/^decorateWith/.test(node.expression.text)) {
      const helper = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === node.expression.text);
      if (!helper) fail(node, `the helper ${node.expression.text} sets fields on the document and is not a function of this file`);
      const parameter = helper.parameters[0].name.getText(), outer = conditions(node, fn);
      const inner = (n) => {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.expression.getText() === parameter) {
          const held = [...outer, ...conditions(n, helper)], read = optionsRead(n.right), type = declaredType(n.right);
          const names = [...read, ...held.flatMap((text) => [...text.matchAll(/options\??\.([A-Za-z_]+)/g)].map((m) => m[1]))];
          fields.set(n.left.name.text, { name: n.left.name.text, type: type.type, typeFrom: type.from, ...(type.optional ? { optional: true } : {}), sentWhen: classify(held, names), source: where(n), by: helper.name.text });
        }
        ts.forEachChild(n, inner);
      };
      inner(helper);
    }
    // X.field = value
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && documents.has(node.left.expression.getText())) add(node.left.name.text, node.right, node);
    // X['field'] = value with a literal key
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(node.left) && documents.has(node.left.expression.getText())) {
      if (ts.isStringLiteral(node.left.argumentExpression)) add(node.left.argumentExpression.text, node.right, node); else fail(node, `a field assigned under a computed name (${textOf(node.left)}) in ${label}`);
    }
    // Object.assign(X, { field: value })
    if (ts.isCallExpression(node) && node.expression.getText() === "Object.assign" && node.arguments.length >= 2 && documents.has(node.arguments[0].getText())) {
      for (const argument of node.arguments.slice(1)) { if (!ts.isObjectLiteralExpression(argument)) fail(argument, `Object.assign from something other than a literal in ${label}`); for (const p of argument.properties) add(p.name.getText(), p.initializer ?? p.name, p); }
    }
    // decorateWithX(command, …): a helper that sets one field
    if (ts.isCallExpression(node) && /^decorateWith[A-Z]/.test(node.expression.getText()) && node.arguments.length && documents.has(node.arguments[0].getText())) {
      const helper = node.expression.getText(), field = { decorateWithCollation: "collation", decorateWithReadConcern: "readConcern", decorateWithExplain: "explain" }[helper];
      if (!field) fail(node, `the helper ${helper}, whose field this reader does not know`);
      add(field, node.arguments[2] ?? node.arguments[1], node, { by: helper });
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return { name, begins, fields: [...fields.values()] };
}
function setLiteral(source, setName) {
  if (!setName) return undefined;
  let found;
  const visit = (n) => { if (ts.isVariableDeclaration(n) && n.name.getText() === setName && n.initializer && ts.isNewExpression(n.initializer)) { const array = n.initializer.arguments?.[0]; if (array && ts.isArrayLiteralExpression(array)) found = { set: setName, names: new Set(array.elements.map((e) => e.text)) }; } ts.forEachChild(n, visit); };
  visit(source);
  return found;
}
function findOptions(fn) {
  let found; const visit = (n) => { if (!found && ts.isPropertyAccessExpression(n) && n.getText() === "this.options") found = n; if (!found) ts.forEachChild(n, visit); }; visit(fn);
  if (!found) fail(fn, "no this.options to read the options' type from");
  return found;
}

for (const file of files.sort()) {
  if (NOT_READ[file]) { skipped.push({ file: "src/operations/" + file, why: NOT_READ[file] }); continue; }
  const source = program.getSourceFile(path.join(operations, file));
  const builders = [];
  const visit = (node) => {
    if (ts.isClassDeclaration(node)) for (const member of node.members) if (ts.isMethodDeclaration(member) && /^buildCommandDocument$|^buildCommand$/.test(member.name.getText()) && member.body) builders.push({ fn: member, label: `${node.name?.text}.${member.name.getText()}`, kind: "command", className: node.name?.text, parent: node.heritageClauses?.[0]?.types[0]?.expression.getText() });
    if (ts.isFunctionDeclaration(node) && node.body && /^make[A-Z]\w*(Command|Statement)$/.test(node.name?.text ?? "")) builders.push({ fn: node, label: node.name.text, kind: /Statement$/.test(node.name.text) ? "statement" : "command" });
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!builders.length) { skipped.push({ file: "src/operations/" + file, why: "defines no command builder (a base class or a helper)" }); continue; }
  for (const builder of builders) {
    const read = readBuilder(builder.fn, builder.label, source);
    if (!read.name && !read.begins && !read.fields.length) { skipped.push({ file: "src/operations/" + file + " " + builder.label, why: "delegates to another builder and adds nothing" }); continue; }
    table.set(`${file}#${builder.label}`, { builder: builder.label, kind: builder.kind, file: "src/operations/" + file, line: where(builder.fn).line, command: read.name ?? null, ...(builder.className ? { class: builder.className } : {}), ...(builder.parent ? { extends: builder.parent } : {}), ...(read.begins ? { addsTo: read.begins === "the class it extends" ? builder.parent : builder.className } : {}), fields: read.fields });
  }
}
const envelope = [];
for (const one of ENVELOPE) {
  const source = program.getSourceFile(path.join(checkout, one.file)); let fn;
  const visit = (node) => {
    if (!fn && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name?.getText() === one.function) fn = node;
    if (!fn && ts.isConstructorDeclaration(node) && one.function === "constructor" && node.parent.name?.text === one.inClass) fn = node;
    if (!fn) ts.forEachChild(node, visit);
  };
  visit(source);
  if (!fn) throw new Error(`${one.file}: no ${one.function} to read the envelope from`);
  const read = readBuilder(fn, `${one.layer}: ${one.function}`, source, [one.document]);
  if (!read.fields.length) throw new Error(`${one.file}: ${one.function} sets no field on ${one.document}; the envelope is not read`);
  envelope.push({ layer: one.layer, file: one.file, line: where(fn).line, fields: read.fields.map((field) => ({ ...field, source: { ...field.source, file: one.file } })) });
}
const manifest = JSON.parse(fs.readFileSync(path.join(checkout, "package.json"), "utf8"));
const identity = { package: manifest.name, version: manifest.version, commit: flag("--commit"), licence: manifest.license, archive: { url: flag("--archive-url"), sha256: flag("--archive-sha256") } };
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
const all = [...table.values()];
fs.writeFileSync(outFile, JSON.stringify({ format: "driver-command-builders", driver: identity, builders: all, envelope, notRead: skipped, notes }, null, 2) + "\n");
const count = (form) => all.reduce((sum, builder) => sum + builder.fields.filter((field) => field.sentWhen.form === form).length, 0);
console.log(`${all.length} builders in ${new Set(all.map((b) => b.file)).size} files; fields: ${all.reduce((s, b) => s + b.fields.length, 0)} (always ${count("always")}, given ${count("given")}, wire-version ${count("wire-version")}, other ${count("other")}); unknown type ${all.reduce((s, b) => s + b.fields.filter((f) => f.type === "unknown" || f.type === "any").length, 0)}`);
for (const builder of all) console.log(`  ${builder.command ?? `(adds to ${builder.addsTo ?? "?"})`}  [${builder.builder}, ${builder.file}:${builder.line}]  ${builder.fields.map((f) => f.name + (f.sentWhen.form === "other" ? "*" : "")).join(" ")}`);
console.log(`envelope: ${envelope.map((one) => `${one.layer} (${one.file}:${one.line}): ${one.fields.map((f) => f.name).join(" ")}`).join("; ")}`);
console.log(`not read (${skipped.length}):`); for (const one of skipped) console.log(`  ${one.file}: ${one.why}`);
console.log(`notes (${notes.length}):`); for (const one of notes) console.log(`  ${one.file}:${one.line} ${one.builder}: ${one.note}`);
