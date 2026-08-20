#!/usr/bin/env node
// Guardián del repo: este repositorio es PÚBLICO, así que lo que entra ya no sale
// del historial. Comprueba lo que no se puede deshacer — credenciales, datos de
// cliente, hosts internos, ficheros gordos — antes de que llegue a un commit.
//
//   node check.mjs            comprueba los ficheros versionados
//   node check.mjs --staged   comprueba solo lo que está en el índice (pre-commit)
//
// Sale con código 1 si encuentra algo que bloquea.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const staged = process.argv.includes('--staged');

const MAX_BYTES = 1024 * 1024;

// Los únicos hosts que tienen sentido en una receta publicada.
const ALLOWED_HOSTS = new Set([
  'api.veetal.app',
  'connect-api.veetal.app',
  'dashboard.veetal.app',
  'developers.veetal.app',
  'mcp.veetal.app',
  'github.com',
  'raw.githubusercontent.com',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]);

// Rutas que no deben existir en el repo, pase lo que pase.
const FORBIDDEN_PATHS = [
  { re: /(^|\/)\.env$/, why: 'un .env real (usa .env.example con valores vacíos)' },
  { re: /(^|\/)node_modules\//, why: 'node_modules' },
  { re: /(^|\/)report\.(csv|html)$/, why: 'salida generada — suele llevar datos de un hotel real' },
  { re: /\.(pem|p12|pfx|keystore)$/, why: 'un fichero de claves' },
  { re: /(^|\/)id_(rsa|ed25519|ecdsa)$/, why: 'una clave SSH privada' },
  { re: /(^|\/)\.npmrc$/, why: 'un .npmrc (suele llevar tokens de registro)' },
];

// Credenciales. Cada patrón es específico a propósito: un falso positivo que se
// ignora entrena a la gente a ignorar la herramienta entera.
// Valores que a ojo no son una credencial: fixtures de test y marcadores de
// posición. Sin esto el guardián ladra al propio test.mjs, y una herramienta que
// da falsos positivos se acaba ignorando entera.
const PLACEHOLDER = /^(?:$|x+$|\.\.\.|<|\{)|test|fake|dummy|sample|example|placeholder|changeme|your[_-]|my[_-]|xxx|abc123|secret_here/i;

const SECRET_PATTERNS = [
  {
    re: /VEETAL_API_KEY\s*[:=]\s*['"]?([A-Za-z0-9_-]{8,})/i,
    why: 'una VEETAL_API_KEY con valor',
  },
  { re: /\bsk-[A-Za-z0-9]{20,}/, why: 'una clave de OpenAI' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, why: 'una clave de Anthropic' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, why: 'un token de GitHub' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/, why: 'un token de GitHub' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, why: 'una access key de AWS' },
  { re: /\bpat[A-Za-z0-9]{14}\.[A-Za-z0-9]{40,}/, why: 'un token de Airtable' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, why: 'un token de Slack' },
  {
    re: /(?:api[_-]?key|\bkey|secret|password|passwd|token|credential)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{16,}['"]/i,
    why: 'una credencial escrita a pelo',
  },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: 'una clave privada' },
];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

const files = git(...(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACM'] : ['ls-files']))
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean);

const errors = [];
const warnings = [];

// Un fichero binario no se escanea por texto, pero sí por tamaño y por ruta.
const isProbablyText = (buf) => !buf.subarray(0, 8000).includes(0);

for (const file of files) {
  for (const { re, why } of FORBIDDEN_PATHS) {
    if (re.test(file)) errors.push(`${file}: es ${why}`);
  }

  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    continue; // borrado entre el listado y la lectura
  }

  if (buf.length > MAX_BYTES) {
    errors.push(`${file}: ocupa ${(buf.length / 1024 / 1024).toFixed(1)} MB (máximo 1 MB)`);
  }
  if (!isProbablyText(buf)) continue;

  const text = buf.toString('utf8');

  // El propio guardián y el AGENTS.md contienen los patrones como documentación.
  const isSelfReferential = file === 'check.mjs' || file === 'AGENTS.md';
  const isLockfile = /(^|\/)\.?(package-lock\.json|npm-shrinkwrap\.json)$/.test(file);

  text.split('\n').forEach((line, i) => {
    if (!isSelfReferential) {
      for (const { re, why } of SECRET_PATTERNS) {
        const hit = line.match(re);
        // Cuando el patrón captura el valor, se perdona si es un marcador.
        if (hit && !(hit[1] && PLACEHOLDER.test(hit[1]))) {
          errors.push(`${file}:${i + 1}: parece ${why}`);
        }
      }
    }

    // Un lockfile es una lista de URLs del registro por definición: escanearlo
    // produce decenas de avisos legítimos, y una herramienta que avisa de lo normal
    // acaba ignorándose entera — justo lo que no puede pasar con esta.
    if (isLockfile) return;

    for (const match of line.matchAll(/https?:\/\/([A-Za-z0-9._-]+)/g)) {
      const host = match[1];
      if (!ALLOWED_HOSTS.has(host)) {
        warnings.push(`${file}:${i + 1}: host no habitual "${host}" — ¿es interno?`);
      }
    }
  });
}

for (const w of warnings) console.warn(`  aviso  ${w}`);

if (errors.length) {
  console.error(`\n✖ ${errors.length} problema(s) que NO pueden llegar a un repo público:\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error('\nEste repo es público: una vez subido, el historial ya no se puede limpiar.');
  console.error('Si has commiteado una credencial, ROTA la clave — no basta con borrarla.\n');
  process.exit(1);
}

console.log(`✓ ${files.length} ficheros revisados, nada que bloquee${warnings.length ? ` (${warnings.length} aviso(s))` : ''}`);
