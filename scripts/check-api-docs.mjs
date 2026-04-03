import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const apiRoot = path.join(repoRoot, 'src', 'app', 'api');
const docsPath = path.join(repoRoot, 'docs', 'api.md');

function listRouteFiles(rootDir) {
  const results = [];

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listRouteFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name === 'route.ts') {
      results.push(fullPath);
    }
  }

  return results;
}

function getRoutePath(routeFile) {
  const relativeDir = path.relative(apiRoot, path.dirname(routeFile)).split(path.sep).join('/');
  return relativeDir === '' ? '/api' : `/api/${relativeDir}`;
}

function getImplementedPairs(routeFile) {
  const source = fs.readFileSync(routeFile, 'utf8');
  const routePath = getRoutePath(routeFile);
  const methods = [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/g)]
    .map((match) => match[1]);

  return methods.map((method) => `${method} ${routePath}`);
}

function getDocumentedPairs() {
  const source = fs.readFileSync(docsPath, 'utf8');
  const matches = [...source.matchAll(/\|\s*`(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)`\s*\|\s*`([^`]+)`\s*\|/g)];
  return new Set(matches.map((match) => `${match[1]} ${match[2]}`));
}

const implementedPairs = listRouteFiles(apiRoot)
  .flatMap(getImplementedPairs)
  .sort();
const documentedPairs = getDocumentedPairs();

const missingInDocs = implementedPairs.filter((pair) => !documentedPairs.has(pair));
const staleInDocs = [...documentedPairs]
  .filter((pair) => pair.startsWith('GET /api/') || pair.startsWith('POST /api/') || pair.startsWith('PUT /api/') || pair.startsWith('PATCH /api/') || pair.startsWith('DELETE /api/') || pair.startsWith('OPTIONS /api/') || pair.startsWith('HEAD /api/'))
  .filter((pair) => !implementedPairs.includes(pair))
  .sort();

if (missingInDocs.length === 0 && staleInDocs.length === 0) {
  console.log('API docs route inventory is in sync.');
  process.exit(0);
}

if (missingInDocs.length > 0) {
  console.error('Missing API doc entries:');
  for (const pair of missingInDocs) {
    console.error(`  - ${pair}`);
  }
}

if (staleInDocs.length > 0) {
  console.error('Stale API doc entries:');
  for (const pair of staleInDocs) {
    console.error(`  - ${pair}`);
  }
}

process.exit(1);
