export interface Site {
  ID: number
  Domains: string
  PrimaryDomain: string
  UpstreamScheme: string
  UpstreamHost: string
  UpstreamPort: number
  UpstreamURL: string
  Enabled: boolean
  HTTPS: boolean
  ForceHTTPS: boolean
  SkipTLSVerify: boolean
  BasicUser: string
  HasBasicAuth: boolean
  Advanced: string
  Note: string
  Links: { Domain: string; URL: string; Linkable: boolean }[]
}

export interface Certificate {
  Domain: string
  Found: boolean
  Parsed: boolean
  CertPath: string
  KeyPath: string
  Issuer: string
  NotBefore: string
  NotAfter: string
}

export interface PageData {
  Version: string
  Path: string
  Theme: 'light' | 'dark'
  User?: { ID: number; Username: string }
  CSRF?: string
  Flash?: { Kind: 'ok' | 'err' | 'warn'; Message: string }
  Error?: string
  Username?: string
  Sites?: Site[]
  EnabledCount?: number
  HTTPSCount?: number
  Status?: { Connected: boolean; Addr: string; Error: string }
  Site?: Site
  Title?: string
  Action?: string
  IsNew?: boolean
  DomainsText?: string
  Certs?: Certificate[]
  CertRoot?: string
  CertAvailable?: boolean
  DataDir?: string
  Caddyfile?: string
  Versions?: {
    ID: number
    CreatedAt: number
    Reason: string
    OK: boolean
    Detail: string
  }[]
  ACMEEmail?: string
  ACMECA?: string
  CaddyVersion?: string
  CaddyVersionErr?: string
  CaddyBinPath?: string
  CaddyLatest?: { Version: string; URL: string; CheckedAt: string }
  CaddyOutdated?: boolean
  CaddyUpgradable?: boolean
  CaddyUpgradeBlocked?: string
  CaddyJob?: { State: 'running' | 'ok' | 'failed'; Log: string; Err: string }
}

export interface PageResponse {
  page: string
  data: PageData
}
export type ServerResponse = PageResponse | { redirect: string }
