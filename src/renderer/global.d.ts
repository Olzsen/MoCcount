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
      launchProfilesTiled(ids: string[]): Promise<void>;
      createDesktopShortcut(id: string): Promise<{ ok: boolean; message: string }>;
      updateApplication(): Promise<{ ok: boolean; message: string; restartRequired?: boolean; version?: string }>;
      onUpdateStatus(callback: (message: { type: string; message: string; version?: string; percent?: number }) => void): () => void;
    };
    moccountGroup: {
      navigate(groupId: string, profileId: string, value: string): Promise<void>;
      back(groupId: string, profileId: string): Promise<void>;
      forward(groupId: string, profileId: string): Promise<void>;
      reload(groupId: string, profileId: string): Promise<void>;
      toggleAlwaysOnTop(groupId: string): Promise<boolean>;
      setInteractionSync(groupId: string, enabled: boolean): Promise<boolean>;
      onUrlChange(callback: (message: { profileId: string; url: string }) => void): () => void;
    };
  }
}
export {};
