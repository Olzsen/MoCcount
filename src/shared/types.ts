export type ProxyType = 'http' | 'https' | 'socks5';
export type ProfileStatus = 'stopped' | 'starting' | 'running';

export interface ProxyConfig {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface BrowserSettings {
  startUrl: string;
  width: number;
  height: number;
  locale: string;
  timezone: string;
  userAgent: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  osPlatform: string;
  screenWidth: number;
  screenHeight: number;
  webglVendor: string;
  webglRenderer: string;
}

export interface BrowserProfile {
  id: string;
  name: string;
  avatar: string;
  color: string;
  createdAt: string;
  proxy?: ProxyConfig;
  browser: BrowserSettings;
  userDataPath: string;
}

export interface ProfileDraft {
  name: string;
  avatar: string;
  color: string;
  proxy?: ProxyConfig;
  browser: BrowserSettings;
}

export interface ProfileSummary extends Omit<BrowserProfile, 'proxy'> {
  proxy?: Omit<ProxyConfig, 'password'> & { hasPassword: boolean };
  status: ProfileStatus;
}
