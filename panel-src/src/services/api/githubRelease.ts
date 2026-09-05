const LATEST_RELEASE_URL =
  'https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest';

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  content_type: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

export interface LatestCliProxyRelease extends GitHubRelease {
  asset: GitHubReleaseAsset;
}

export async function fetchLatestCliProxyRelease(): Promise<LatestCliProxyRelease> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`GitHub release request failed (HTTP ${response.status})`);
  }

  const release = (await response.json()) as GitHubRelease;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((candidate) =>
        /(?:^|[_-])windows[_-]amd64(?:[_-]|\.)[^/]*\.zip$/i.test(candidate.name)
      ) ??
      release.assets.find(
        (candidate) =>
          /windows[_-]amd64/i.test(candidate.name) && candidate.name.toLowerCase().endsWith('.zip')
      )
    : undefined;

  if (!release.tag_name || !release.html_url) {
    throw new Error('GitHub returned an invalid latest release');
  }
  if (!asset) {
    throw new Error('The latest release has no windows_amd64 ZIP asset');
  }

  return { ...release, asset };
}
