import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
await import('./src/scripts/seed-settings.js');
