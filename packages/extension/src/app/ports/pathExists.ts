/**
 * Port: whether a path exists on disk. Implemented by `adapters/fs/pathExists.ts`; declared here so
 * a use-case can be handed a stub and never reach the real filesystem in a test.
 *
 * A bare function type rather than an interface, matching how this dependency is already expressed
 * elsewhere — `exists` in `core/git/gitService.ts` and `avatarUrl` on `RepoContext`.
 */
export type PathExists = (path: string) => Promise<boolean>;
