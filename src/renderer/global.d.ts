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
      launchProfilesTogether(ids: string[]): Promise<void>;
    };
    moccountGroup: {
      navigate(groupId: string, value: string): Promise<void>;
      back(groupId: string): Promise<void>;
      forward(groupId: string): Promise<void>;
      reload(groupId: string): Promise<void>;
      onUrlChange(callback: (url: string) => void): () => void;
    };
  }
}
export {};
