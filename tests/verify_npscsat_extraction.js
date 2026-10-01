const fs = require('fs');
const path = require('path');
const { extractNpsCsatResponses } = require('../lib/transforms');

const TR = 'C:\\Users\\amand\\.claude\\projects\\c--Users-amand--claude\\43da95f9-467f-4fe1-9caa-25695fdcec05\\tool-results';
const files = fs.readdirSync(TR).filter(f =>
  f.startsWith('mcp-cockpit-cockpit_query_history-17907072') ||
  f.startsWith('mcp-cockpit-cockpit_query_history-17907073')
);
console.log('files found:', files.length);

let rows = [];
files.forEach(f => {
  const d = JSON.parse(fs.readFileSync(path.join(TR, f), 'utf-8'));
  rows.push(...d.data);
});
console.log('total rows:', rows.length);

const { projects, responses } = extractNpsCsatResponses(rows);
console.log('projects:', projects.length, '(expected 226)');
console.log('responses:', responses.length, '(expected 435)');
console.log(JSON.stringify(responses.slice(0, 3), null, 1));
