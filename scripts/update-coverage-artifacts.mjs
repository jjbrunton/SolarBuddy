import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const options = {
    input: 'coverage/coverage-summary.json',
    badgeOutput: 'public/badges/coverage.svg',
    summaryOutput: 'coverage/coverage-summary.md',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '--input') {
      options.input = next;
      index += 1;
      continue;
    }

    if (arg === '--badge-output') {
      options.badgeOutput = next;
      index += 1;
      continue;
    }

    if (arg === '--summary-output') {
      options.summaryOutput = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function badgeColor(percent) {
  if (percent >= 90) {
    return '#2ea043';
  }
  if (percent >= 80) {
    return '#97ca00';
  }
  if (percent >= 70) {
    return '#dfb317';
  }
  if (percent >= 60) {
    return '#fe7d37';
  }
  return '#e05d44';
}

function textWidth(text) {
  return text.length * 7 + 10;
}

function createBadgeSvg(label, message, color) {
  const labelWidth = textWidth(label);
  const messageWidth = textWidth(message);
  const width = labelWidth + messageWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(message)}">
  <title>${escapeXml(label)}: ${escapeXml(message)}</title>
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
    <stop offset=".9" stop-opacity=".3"/>
    <stop offset="1" stop-opacity=".5"/>
  </linearGradient>
  <clipPath id="clip">
    <rect width="${width}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#clip)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#smooth)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${Math.floor(labelWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${Math.floor(labelWidth / 2)}" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth + Math.floor(messageWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(message)}</text>
    <text x="${labelWidth + Math.floor(messageWidth / 2)}" y="14">${escapeXml(message)}</text>
  </g>
</svg>
`;
}

function formatMetricRow(name, metric) {
  return `| ${name} | ${metric.pct.toFixed(1)}% | ${metric.covered}/${metric.total} |`;
}

const options = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(options.input);
const badgeOutputPath = path.resolve(options.badgeOutput);
const summaryOutputPath = path.resolve(options.summaryOutput);

const rawSummary = fs.readFileSync(inputPath, 'utf8');
const coverageSummary = JSON.parse(rawSummary);
const total = coverageSummary.total;

if (!total?.lines || !total?.statements || !total?.functions || !total?.branches) {
  throw new Error(`Coverage summary at ${options.input} is missing total metrics`);
}

const linesPercent = total.lines.pct;
const badgeSvg = createBadgeSvg('coverage', `${linesPercent.toFixed(1)}%`, badgeColor(linesPercent));
const markdownSummary = [
  '## Coverage Summary',
  '',
  '| Metric | Percent | Covered / Total |',
  '| --- | ---: | ---: |',
  formatMetricRow('Lines', total.lines),
  formatMetricRow('Statements', total.statements),
  formatMetricRow('Functions', total.functions),
  formatMetricRow('Branches', total.branches),
  '',
  'Scope: backend and API code under `src/lib/` and `src/app/api/`.',
  '',
  'The full HTML report is published as the `coverage-report` workflow artifact.',
  '',
].join('\n');

fs.mkdirSync(path.dirname(badgeOutputPath), { recursive: true });
fs.mkdirSync(path.dirname(summaryOutputPath), { recursive: true });
fs.writeFileSync(badgeOutputPath, badgeSvg, 'utf8');
fs.writeFileSync(summaryOutputPath, markdownSummary, 'utf8');
