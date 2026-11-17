export type FileKind = 'file' | 'folder';
export type UserRole = 'admin' | 'user';
export type ConflictRule = 'rename' | 'overwrite' | 'reject';

export interface User {
  id: string;
  username: string;
  email: string;
  name: string;
  role: UserRole;
  quotaBytes: number;
  usedBytes?: number;
  createdAt: string;
}

export interface DriveFile {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  kind: FileKind;
  size: number;
  mime: string;
  starred: boolean;
  trashed: boolean;
  shareCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StorageStats {
  usedBytes: number;
  trashedBytes: number;
  quotaBytes: number;
  fileCount: number;
  folderCount: number;
  maxUploadMb: number;
}

export interface ShareLink {
  id: string;
  fileId: string;
  fileName?: string;
  fileKind?: FileKind;
  fileSize?: number;
  token: string;
  url: string;
  hasPassword?: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface AuthTokens {
  token: string;
  user: User;
}

export interface ListResponse {
  items: DriveFile[];
  breadcrumbs: { id: string | null; name: string }[];
  stats?: StorageStats;
}

export interface DriveRules {
  allowRegister: boolean;
  maxUploadMb: number;
  trashRetentionDays: number;
  conflictRule: ConflictRule;
  defaultQuotaMb: number;
  blockedExtensions: string;
}

export interface PublishStatus {
  mode: 'off' | 'quick' | 'token';
  status: 'off' | 'downloading' | 'starting' | 'connected' | 'error';
  url: string;
  publicUrl: string;
  hasToken: boolean;
  localUrl: string;
  lanUrls: string[];
  apkAvailable: boolean;
  apkUrl: string | null;
  log: string[];
}

export interface ApiError {
  message: string;
  code?: string;
}
