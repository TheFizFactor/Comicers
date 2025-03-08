interface ReleaseAsset {
  platform: string;
  name: string;
  browser_download_url: string;
  buildTimeStr: string;
}

export interface Release {
  version: string;
  releaseDateStr: string;
  releaseDaysAgo: number;
  assets: ReleaseAsset[];
}

const defaultRelease: Release = {
  version: '0.0.0',
  releaseDateStr: new Date().toLocaleDateString(),
  releaseDaysAgo: 0,
  assets: []
};

// For VitePress data loading format
export default {
  async load() {
    const data = { ...defaultRelease };
    
    try {
      const response = await fetch('https://api.github.com/repos/TheFizFactor/comicers/releases/latest');
      if (!response.ok) {
        return data;
      }

      const release = await response.json();
      const date = new Date(release.published_at);
      
      // Safely find assets
      const findAsset = (pattern: RegExp) => 
        release.assets?.find((asset: any) => pattern.test(asset.name)) || null;

      const assets = {
        windows: findAsset(/Comicers-Setup-.*\.exe$/),
        mac: findAsset(/\.dmg$/),
        linux: findAsset(/\.AppImage$/)
      };

      // Only include assets that were found
      const validAssets: ReleaseAsset[] = [];

      if (assets.windows) {
        validAssets.push({
          platform: 'Windows',
          name: assets.windows.name,
          browser_download_url: assets.windows.browser_download_url,
          buildTimeStr: new Date(assets.windows.updated_at).toISOString()
        });
      }

      if (assets.mac && assets.mac.name) {
        validAssets.push({
          platform: 'macOS',
          name: assets.mac.name,
          browser_download_url: assets.mac.browser_download_url,
          buildTimeStr: new Date(assets.mac.updated_at).toISOString()
        });
      }

      if (assets.linux && assets.linux.name) {
        validAssets.push({
          platform: 'Linux',
          name: assets.linux.name,
          browser_download_url: assets.linux.browser_download_url,
          buildTimeStr: new Date(assets.linux.updated_at).toISOString()
        });
      }

      // Update the data object
      data.version = release.tag_name?.replace('v', '') || defaultRelease.version;
      data.releaseDateStr = date.toLocaleDateString();
      data.releaseDaysAgo = Math.round((new Date().getTime() - date.getTime()) / (1000 * 3600 * 24));
      data.assets = validAssets;

      return data;
    } catch (error) {
      console.error('Failed to load release data:', error);
      return data;
    }
  }
};