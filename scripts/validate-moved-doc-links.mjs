import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const documents = [
  'docs/lsp.md',
  'docs/vscode.md',
  'docs/rql-vscode.md',
  'docs/zed.md',
  'docs/neovim.md',
  'docs/helix.md',
];

function withoutFencedCode(markdown) {
  const result = [];
  let fence = null;

  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (fence === null) {
        fence = marker[1][0];
      } else if (marker[1][0] === fence) {
        fence = null;
      }
      continue;
    }
    if (fence === null) result.push(line);
  }

  return result.join('\n');
}

const failures = [];
let checked = 0;

for (const document of documents) {
  const absoluteDocument = path.join(root, document);
  const markdown = withoutFencedCode(fs.readFileSync(absoluteDocument, 'utf8'));
  const links = /!?\[[^\]]*\]\((<[^>]+>|(?:\\.|[^)\s])+)(?:\s+[^)]*)?\)/g;

  for (const match of markdown.matchAll(links)) {
    const destination = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) continue;

    checked += 1;
    const pathname = destination.split(/[?#]/, 1)[0];
    const target = pathname
      ? path.resolve(path.dirname(absoluteDocument), decodeURIComponent(pathname))
      : absoluteDocument;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      failures.push(`${document}: ${destination}`);
    }
  }
}

if (failures.length) {
  console.error(`Checked ${checked} relative Markdown targets; ${failures.length} failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${checked} relative Markdown targets across ${documents.length} documents; all resolve to files.`);
}
