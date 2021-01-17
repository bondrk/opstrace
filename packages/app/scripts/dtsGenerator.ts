import path from "path";
import * as glob from "glob";
import * as ts from "typescript";
import { init, parse } from 'es-module-lexer';

const OUTPUT_DIRECTORY = path.resolve(process.cwd(), "src/tmp-lib");

const sourceFiles = glob
  .sync(path.resolve(process.cwd(), "src/lib/*.{ts,tsx}"))
  .filter(f => !/__tests__|\.spec\.|\.stories\./.test(f));

const options: ts.CompilerOptions = {
  jsx: ts.JsxEmit.React,
  allowJs: true,
  allowNonTsExtensions: true,
  target: ts.ScriptTarget.ES2015,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  declaration: true,
  sourceMap: true,
  module: ts.ModuleKind.ES2020,
  lib: ["es6", "dom"],
  baseUrl: "src",
  paths: {
    "client/*": ["client/*"],
    "server/*": ["server/*"],
    "state/*": ["state/*"],
    "workers/*": ["workers/*"]
  }
};

function fileExists(fileName: string): boolean {
  return ts.sys.fileExists(fileName);
}

function readFile(fileName: string): string | undefined {
  return ts.sys.readFile(fileName);
}

function writeFile(fileName: string, data: string) {
  const outFile = path.join(OUTPUT_DIRECTORY, fileName.replace(/^.*src/, ""));
  ts.sys.writeFile(outFile, data);
}

function getSourceFile(fileName: string, languageVersion: ts.ScriptTarget) {
  const sourceText = ts.sys.readFile(fileName);
  return sourceText !== undefined
    ? ts.createSourceFile(fileName, sourceText, languageVersion)
    : undefined;
}

function createProgram() {
  const host: ts.CompilerHost = {
    getDefaultLibFileName: () => "lib.d.ts",
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getDirectories: path => ts.sys.getDirectories(path),
    getCanonicalFileName: fileName =>
      ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    getNewLine: () => ts.sys.newLine,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getSourceFile,
    writeFile,
    fileExists,
    readFile,
    resolveModuleNames
  };
  return ts.createProgram(sourceFiles, options, host);
}

function resolveModuleNames(
  moduleNames: string[],
  containingFile: string
): (undefined | ts.ResolvedModule)[] {
  const resolvedModules: (undefined | ts.ResolvedModule)[] = [];
  for (const moduleName of moduleNames) {
    // try to use standard resolution
    let result = ts.resolveModuleName(moduleName, containingFile, options, {
      fileExists,
      readFile
    });
    if (result.resolvedModule) {
      resolvedModules.push(result.resolvedModule);
    } else {
      resolvedModules.push(undefined);
    }
  }
  return resolvedModules;
}

function getVirtualDtsPath(resolvedImportPath: string) {
  return /\/node_modules\//.test(resolvedImportPath)
    ? resolvedImportPath.replace(/^.*node_modules\//, "@node_modules/")
    : resolvedImportPath.replace(/^.*src\//, "@opstrace/");
}

function removeExtension(fileName: string) {
  return fileName
    .substr(0, fileName.length - path.extname(fileName).length)
    .replace(/\.d$/, "");
}

function rewritePath(
  importPath: string,
  sf: ts.SourceFile,
  filesToVisit: string[],
  afterDeclarations?: boolean
) {
  if (importPath.startsWith("http://") || importPath.startsWith("https://") || importPath.startsWith("@node_modules")) {
    // don't rewrite relative imports
    return importPath;
  }

  const resolvedImports = resolveModuleNames([importPath], sf.fileName);
  const absImportPath = resolvedImports[0]?.resolvedFileName;
  if (!absImportPath) {
    return importPath;
  }
  const resolvedImportPath = path.resolve(absImportPath);
  filesToVisit.push(resolvedImportPath);

  const virtualDtsPath = getVirtualDtsPath(resolvedImportPath);

  return removeExtension(afterDeclarations ? virtualDtsPath : importPath);
}

function isDynamicImport(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  );
}

function resolveTypeReferenceDirectives(sf: ts.SourceFile) {
  const resolvedTypeReferences: string[] = [];
  sf.typeReferenceDirectives.forEach(ref => {
    const resolvedFile = resolveModuleNames([ref.fileName], sf.fileName)[0]
      ?.resolvedFileName;
    if (resolvedFile) {
      resolvedTypeReferences.push(resolvedFile);
    }
  });
  return resolvedTypeReferences;
}

function getImportPathForNode(node: ts.Node, sf: ts.SourceFile) {
  let importPath: string = "";
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier
  ) {
    const importPathWithQuotes = node.moduleSpecifier.getText(sf);
    importPath = importPathWithQuotes.substr(
      1,
      importPathWithQuotes.length - 2
    );
  } else if (isDynamicImport(node)) {
    const importPathWithQuotes = node.arguments[0].getText(sf);
    importPath = importPathWithQuotes.substr(
      1,
      importPathWithQuotes.length - 2
    );
  } else if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteral(node.argument.literal)
  ) {
    importPath = node.argument.literal.text;
  }
  return importPath;
}

function importExportVisitor(
  ctx: ts.TransformationContext,
  sf: ts.SourceFile,
  filesToVisit: string[],
  afterDeclarations?: boolean
) {
  filesToVisit.push(...resolveTypeReferenceDirectives(sf));

  const visitor: ts.Visitor = (node: ts.Node): ts.Node => {
    const importPath = getImportPathForNode(node, sf);

    if (importPath) {
      const rewrittenPath = rewritePath(
        importPath,
        sf,
        filesToVisit,
        afterDeclarations
      );

      // Only rewrite if we changed the value
      if (rewrittenPath !== importPath) {
        if (ts.isImportDeclaration(node)) {
          return ctx.factory.updateImportDeclaration(
            node,
            node.decorators,
            node.modifiers,
            node.importClause,
            ctx.factory.createStringLiteral(rewrittenPath)
          );
        } else if (ts.isExportDeclaration(node)) {
          return ctx.factory.updateExportDeclaration(
            node,
            node.decorators,
            node.modifiers,
            node.isTypeOnly,
            node.exportClause,
            ctx.factory.createStringLiteral(rewrittenPath)
          );
        } else if (isDynamicImport(node)) {
          return ctx.factory.updateCallExpression(
            node,
            node.expression,
            node.typeArguments,
            ctx.factory.createNodeArray([
              ctx.factory.createStringLiteral(rewrittenPath)
            ])
          );
        } else if (ts.isImportTypeNode(node)) {
          return ctx.factory.updateImportTypeNode(
            node,
            ctx.factory.createLiteralTypeNode(
              ctx.factory.createStringLiteral(rewrittenPath)
            ),
            node.qualifier,
            node.typeArguments,
            node.isTypeOf
          );
        }
      }
      return node;
    }
    return ts.visitEachChild(node, visitor, ctx);
  };

  return visitor;
}

function dtsVisitor(
  sf: ts.SourceFile,
  filesToVisit: string[],
  dtsFiles: Map<string, string>,
  afterDeclarations?: boolean
) {
  filesToVisit.push(...resolveTypeReferenceDirectives(sf));

  const visitor: ts.Visitor = (node: ts.Node) => {
    const importPath = getImportPathForNode(node, sf);

    if (importPath) {
      const existingDts = dtsFiles.get(sf.fileName)!;
      const newPath = rewritePath(
        importPath,
        sf,
        filesToVisit,
        afterDeclarations
      );
      console.log(importPath, newPath)
      if (newPath !== importPath) {
        const existingImport = sf.text.substr(node.pos, node.end);

        const updatedImport = existingImport.replace(importPath, newPath);
        // we may have already altered this file, so we need to find
        // the originating index of this specifier. Ideally we don't need to do this
        // because we could use a transform, but not sure if transforms work when reading/emiting only .d.ts files
        const newIndex = existingDts.indexOf(existingImport);

        dtsFiles.set(
          sf.fileName,
          existingDts.slice(0, newIndex) +
            updatedImport +
            existingDts.slice(newIndex + existingImport.length)
        );
      }
    }
    return ts.forEachChild(node, visitor);
  };

  return visitor;
}

function transformImports(filesToVisit: string[], afterDeclarations?: boolean) {
  return (ctx: ts.TransformationContext): ts.Transformer<ts.SourceFile> => {
    return (sf: ts.SourceFile) =>
      ts.visitNode(
        sf,
        importExportVisitor(ctx, sf, filesToVisit, afterDeclarations)
      );
  };
}

function generateDtsFile(dtsFiles: Map<string, string>) {
  let content = `/**
 * Copyright 2020 Opstrace, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
`;
  for (const [fileName, contents] of dtsFiles.entries()) {
    content += `

declare module "${removeExtension(getVirtualDtsPath(fileName))}" {
  ${contents}
}
`;
  }
  ts.sys.writeFile(path.resolve(process.cwd(), "src/opstrace.d.ts"), content);
}

/**
 * Main function to generate dts files
 */
(async function generateDts() {
  const program = createProgram();
  const filesVisited = new Set<string>();
  const filesToVisit = sourceFiles;

  const dtsFiles = new Map<string, string>();
  const dtsFilesVisited = new Set<string>();
  const dtsFilesToVisit: string[] = [];
  let fileName: string | undefined;

  while (filesToVisit.length && (fileName = filesToVisit.pop())) {
    if (fileName.endsWith(".d.ts")) {
      dtsFilesToVisit.push(fileName);
    }
    emitFile(fileName);
  }
  
  await init;

  while (dtsFilesToVisit.length && (fileName = dtsFilesToVisit.pop())) {
    parseDts(fileName);
  }
  // Write the concatenated dts file
  generateDtsFile(dtsFiles);

  async function parseDts(fileName: string) {
    if (dtsFilesVisited.has(fileName)) {
      return;
    }
    dtsFilesVisited.add(fileName);
    console.log("parseDts:", fileName);

    const sf = getSourceFile(fileName, ts.ScriptTarget.ES2020);
    if (!sf) {
      throw Error(`source file could not be created for: ${fileName}`);
    }
    dtsFiles.set(fileName, sf.text);
    filesToVisit.push(...resolveTypeReferenceDirectives(sf));

    ts.forEachChild(sf, dtsVisitor(sf, dtsFilesToVisit, dtsFiles, true));
    let content = dtsFiles.get(fileName)!;
    
    const [imports] = parse(content);
    let delta = 0;

    for(const {s, e} of imports) {
      const importPath = content.substring(s, e);
      const newPath = rewritePath(
        importPath,
        sf,
        filesToVisit,
        true
      );
      if (newPath !== importPath) {
        content = content.slice(0, s + delta) + newPath + content.slice(e + delta);
        delta += newPath.length - importPath.length;
      }
    }
    dtsFiles.set(fileName, content);
  }

  function emitFile(fileName: string) {
    if (filesVisited.has(fileName) || dtsFilesToVisit.includes(fileName)) {
      return;
    }
    filesVisited.add(fileName);
    console.log("emitFile:", fileName);

    program.emit(
      program.getSourceFile(fileName),
      undefined,
      undefined,
      undefined,
      {
        after: [
          transformImports(filesToVisit, false) as ts.TransformerFactory<
            ts.SourceFile
          >
        ],
        afterDeclarations: [
          transformImports(filesToVisit, true) as ts.TransformerFactory<
            ts.SourceFile | ts.Bundle
          >
        ]
      }
    );
  }
})();
