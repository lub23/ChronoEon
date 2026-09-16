import { contentRevision, type MarkdownDocument } from "@chronoeon/markdown";

/**
 * Replay guard: the import id is a SHA-256 over the vault root and the
 * content hash of every scanned file, so re-seeding with the same vault is a
 * no-op and seeding with a different vault is detectable.
 */
export async function computeVaultImportId(vaultRoot: string, documents: MarkdownDocument[]): Promise<string> {
  const files = await Promise.all(documents.map(async (document) => ({
    path: document.path,
    revision: await contentRevision(document.content),
  })));
  return contentRevision(JSON.stringify({ vaultRoot, files }));
}
