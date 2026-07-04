import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Self-signed cert (frontend/certs/) so the dashboard runs on HTTPS — the
// browser mic behind the Talk button only works in a secure context. If the
// cert files are missing the server falls back to plain HTTP.
const certDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'certs');
const keyFile = path.join(certDir, 'dev.key');
const certFile = path.join(certDir, 'dev.crt');
const https = fs.existsSync(keyFile) && fs.existsSync(certFile)
  ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
  : undefined;

// Everything backend-related rides through this proxy so the browser only ever
// talks to the Vite origin (an https page cannot call the plain-http backend).
const backend = 'http://localhost:4000';
const proxy = {
  '/api': backend,
  '/socket.io': { target: backend, ws: true },
  '/screenshots': backend,
  '/recordings': backend,
  '/videos': backend
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    https,
    proxy
  },
  preview: {
    host: '0.0.0.0',
    https,
    proxy
  }
});
