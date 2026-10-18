import type { ProfileDraft, ProfileSummary } from '../shared/types';

declare global {
  interface Window {
    moccount: {
      listProfiles(): Promise<ProfileSummary[]>;
      createProfile(draft: ProfileDraft): Promise<ProfileSummary>;
      updateProfile(id: string, draft: ProfileDraft): Promise<ProfileSummary>;
      deleteProfile(id: string): Promise<void>;
      launchProfile(id: string): Promise<void>;
      stopProfile(id: string): Promise<void>;
      checkProxy(draft: ProfileDraft): Promise<{ ok: boolean; message: string }>;
      clearSiteData(id: string): Promise<void>;
      getRunningIds(): Promise<string[]>;
    };
  }
}
export {};
