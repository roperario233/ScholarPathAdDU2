import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on every interface so phones and other devices on the same
    // network can open the prototype with `npm run dev`.
    host: true,
    port: 5173,
    // Accept device, mDNS, and tunnel hostnames; Vite blocks unknown hosts otherwise.
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
});
