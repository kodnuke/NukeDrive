import type { CapacitorConfig } from '@capacitor/cli';

// Uygulama, apps/web derlemesindeki VITE_API_BASE adresine (HTTPS) bağlanır
const config: CapacitorConfig = {
  appId: 'com.nukedrive.app',
  appName: 'NukeDrive',
  webDir: '../web/dist'
};

export default config;
