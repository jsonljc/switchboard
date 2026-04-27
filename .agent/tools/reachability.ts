import type { SourceFile } from "ts-morph";

const INGRESS_SYMBOL = "PlatformIngress";

export function reachesIngress(sf: SourceFile): boolean {
  if (fileMentions(sf, INGRESS_SYMBOL)) return true;

  // Hop 1: examine each file directly imported by sf.
  for (const importDecl of sf.getImportDeclarations()) {
    const imported = importDecl.getModuleSpecifierSourceFile();
    if (!imported) continue;
    if (fileMentions(imported, INGRESS_SYMBOL)) return true;
  }

  return false;
}

function fileMentions(sf: SourceFile, symbol: string): boolean {
  // Cheap, conservative: substring match on the file text.
  // The allowlist is the safety valve for the false positives this can produce.
  return sf.getFullText().includes(symbol);
}
