import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const extensions = new Set([".ts", ".tsx"]);
const ignored = new Set(["node_modules", "__tests__", "test-env", "test-utils"]);
const callableWrappers = new Set([
  "computedFn",
  "forwardRef",
  "memo",
  "observer",
  "withErrorBoundary",
  "withInjectables",
]);

export function sourceFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      if (ignored.has(entry.name) || entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return extensions.has(path.extname(entry.name)) ? [target] : [];
    })
    .sort();
}

function normalize(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\r\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([<>{}()[\],;:?=|&])\s*/g, "$1")
    .trim();
}

function modifiers(node) {
  return (node.modifiers || [])
    .map(modifier => modifier.getText())
    .filter(value => value !== "export" && value !== "default")
    .join(" ");
}

function typeParameters(node) {
  return node.typeParameters?.length
    ? `<${node.typeParameters.map(parameter => normalize(parameter.getText())).join(",")}>`
    : "";
}

function parameters(node) {
  return `(${(node.parameters || []).map(parameter => normalize(parameter.getText())).join(",")})`;
}

function memberContract(member) {
  const prefix = [modifiers(member), member.name?.getText()].filter(Boolean).join(" ");
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member))
    return normalize(
      `${prefix}${member.questionToken ? "?" : ""}${typeParameters(member)}${parameters(member)}${member.type ? `:${member.type.getText()}` : ""}`,
    );
  if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member))
    return normalize(
      `${prefix}${member.questionToken ? "?" : ""}${member.type ? `:${member.type.getText()}` : ":inferred"}`,
    );
  if (ts.isConstructorDeclaration(member)) return normalize(`constructor${parameters(member)}`);
  if (ts.isGetAccessorDeclaration(member))
    return normalize(`${prefix}()${member.type ? `:${member.type.getText()}` : ":inferred"}`);
  if (ts.isSetAccessorDeclaration(member)) return normalize(`${prefix}${parameters(member)}`);
  if (ts.isCallSignatureDeclaration(member))
    return normalize(
      `call${typeParameters(member)}${parameters(member)}${member.type ? `:${member.type.getText()}` : ""}`,
    );
  if (ts.isConstructSignatureDeclaration(member))
    return normalize(
      `new${typeParameters(member)}${parameters(member)}${member.type ? `:${member.type.getText()}` : ""}`,
    );
  if (ts.isIndexSignatureDeclaration(member))
    return normalize(`[index]${parameters(member)}${member.type ? `:${member.type.getText()}` : ""}`);
  return normalize(member.getText().replace(/\{[\s\S]*$/, ""));
}

function callableInitializer(initializer) {
  if (!initializer) return false;
  while (
    ts.isParenthesizedExpression(initializer) ||
    ts.isAsExpression(initializer) ||
    ts.isSatisfiesExpression(initializer) ||
    ts.isNonNullExpression(initializer)
  )
    initializer = initializer.expression;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return true;
  if (!ts.isCallExpression(initializer)) return false;
  const callee = initializer.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
  if (name === "assign" && ts.isPropertyAccessExpression(callee) && callee.expression.getText() === "Object")
    return callableInitializer(initializer.arguments[0]);
  return callableWrappers.has(name);
}

function variableSignature(name, declaration) {
  const initializer = declaration.initializer;
  let callable = initializer;
  while (
    callable &&
    (ts.isParenthesizedExpression(callable) ||
      ts.isAsExpression(callable) ||
      ts.isSatisfiesExpression(callable) ||
      ts.isNonNullExpression(callable))
  )
    callable = callable.expression;
  if (callable && (ts.isArrowFunction(callable) || ts.isFunctionExpression(callable))) {
    return normalize(
      `${name}${typeParameters(callable)}${parameters(callable)}${callable.type ? `:${callable.type.getText()}` : ":inferred"}`,
    );
  }
  return normalize(
    `${name}${declaration.type ? `:${declaration.type.getText()}` : `:inferred<${initializer ? ts.SyntaxKind[initializer.kind] : "undefined"}>`}`,
  );
}

function declarationSignature(node, name, kind, variableDeclaration) {
  if (kind === "function") {
    if (variableDeclaration) return variableSignature(name, variableDeclaration);
    return normalize(
      `${modifiers(node)} function ${name}${typeParameters(node)}${parameters(node)}${node.type ? `:${node.type.getText()}` : ":inferred"}`,
    );
  }
  if (kind === "class" || kind === "interface") {
    const heritage = node.heritageClauses?.map(clause => clause.getText()).join(" ") || "";
    const members = node.members.map(memberContract).join(";");
    return normalize(`${modifiers(node)} ${kind} ${name}${typeParameters(node)} ${heritage}{${members}}`);
  }
  if (kind === "type") return normalize(`type ${name}${typeParameters(node)}=${node.type.getText()}`);
  return variableSignature(name, variableDeclaration);
}

function sourceArea(relativeFile) {
  if (relativeFile.startsWith("main/")) return "backend";
  if (relativeFile.startsWith("renderer/") || relativeFile.startsWith("features/")) return "frontend";
  return "shared";
}

export function extractContracts(file, base, exportedOnly) {
  const content = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const relativeFile = path.relative(base, file).replaceAll("\\", "/");
  const found = [];
  const add = (node, name, kind, variableDeclaration) => {
    if (!name) return;
    const owner = ts.isVariableDeclaration(node) ? node.parent.parent : node;
    const exported = owner.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) || false;
    if (exportedOnly && !exported) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const signature = declarationSignature(owner, name, kind, variableDeclaration);
    found.push({
      id: `${relativeFile}:${line}:${kind}:${name}`,
      name,
      kind,
      file: relativeFile,
      line,
      exported,
      callable: kind === "function" || kind === "class",
      signature,
      signatureDigest: createHash("sha256").update(signature).digest("hex"),
      ...(exportedOnly ? { area: sourceArea(relativeFile) } : {}),
    });
  };
  source.forEachChild(node => {
    if (ts.isFunctionDeclaration(node)) add(node, node.name?.text, "function");
    else if (ts.isClassDeclaration(node)) add(node, node.name?.text, "class");
    else if (ts.isInterfaceDeclaration(node)) add(node, node.name.text, "interface");
    else if (ts.isTypeAliasDeclaration(node)) add(node, node.name.text, "type");
    else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        add(
          node,
          declaration.name.text,
          callableInitializer(declaration.initializer) ? "function" : "value",
          declaration,
        );
      }
    }
  });
  return found;
}

export function contractsForDirectory(directory, exportedOnly) {
  return sourceFiles(directory).flatMap(file => extractContracts(file, directory, exportedOnly));
}

export function gitCommit(repository) {
  return execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

export function contractsDigest(contracts) {
  return createHash("sha256").update(JSON.stringify(contracts)).digest("hex");
}

export function compareContracts(reference, implementation) {
  const available = new Map();
  for (const item of implementation) {
    const key = `${item.kind}:${item.name}`;
    const bucket = available.get(key) || [];
    bucket.push(item);
    available.set(key, bucket);
  }
  const results = reference.map(expected => {
    const key = `${expected.kind}:${expected.name}`;
    const candidate = available.get(key)?.shift();
    if (!candidate)
      return {
        referenceId: expected.id,
        name: expected.name,
        kind: expected.kind,
        area: expected.area,
        status: "missing",
      };
    return {
      referenceId: expected.id,
      name: expected.name,
      kind: expected.kind,
      area: expected.area,
      status: candidate.signatureDigest === expected.signatureDigest ? "exact" : "signature-drift",
      implementationId: candidate.id,
      expectedSignature: expected.signature,
      actualSignature: candidate.signature,
    };
  });
  const count = status => results.filter(item => item.status === status).length;
  const callableResults = results.filter(item => item.kind === "function" || item.kind === "class");
  const callableCount = status => callableResults.filter(item => item.status === status).length;
  return {
    summary: {
      referenceDeclarations: reference.length,
      implementationDeclarations: implementation.length,
      matched: reference.length - count("missing"),
      exact: count("exact"),
      signatureDrift: count("signature-drift"),
      missing: count("missing"),
      callable: {
        reference: callableResults.length,
        matched: callableResults.length - callableCount("missing"),
        exact: callableCount("exact"),
        signatureDrift: callableCount("signature-drift"),
        missing: callableCount("missing"),
      },
      byArea: Object.fromEntries(
        ["frontend", "backend", "shared"].map(area => {
          const subset = results.filter(item => item.area === area);
          return [
            area,
            {
              total: subset.length,
              matched: subset.filter(item => item.status !== "missing").length,
              exact: subset.filter(item => item.status === "exact").length,
            },
          ];
        }),
      ),
    },
    results,
  };
}
