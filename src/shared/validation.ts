import { z } from 'zod';

export const profileDraftSchema = z.object({
  name: z.string().trim().min(1, 'Enter a profile name').max(60, 'Name must be 60 characters or fewer'),
  avatar: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  proxy: z.object({
    type: z.enum(['http', 'https', 'socks5']),
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    username: z.string().max(255).optional(),
    password: z.string().max(1024).optional(),
  }).optional(),
  browser: z.object({
    startUrl: z.string().trim().min(1).max(2048),
    width: z.number().int().min(800).max(3840),
    height: z.number().int().min(600).max(2160),
    locale: z.string().min(2).max(20),
    timezone: z.string().min(1).max(80),
    userAgent: z.string().max(512).default(''),
    hardwareConcurrency: z.number().int().min(1).max(64).default(8),
    deviceMemory: z.number().min(0.25).max(64).default(8),
    osPlatform: z.enum(['', 'Win32', 'MacIntel', 'Linux x86_64']).default(''),
    screenWidth: z.number().int().min(0).max(7680).default(0),
    screenHeight: z.number().int().min(0).max(4320).default(0),
    webglVendor: z.string().max(128).default(''),
    webglRenderer: z.string().max(256).default(''),
  }),
});
