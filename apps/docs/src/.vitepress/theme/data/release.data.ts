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
  debug?: any; // For debugging purposes
}

const defaultRelease: Release = {
  version: '0.0.0',
  releaseDateStr: 'Not yet released',
  releaseDaysAgo: 0,
  assets: []
};

// Format date consistently to avoid hydration mismatches
function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// For VitePress data loading format
export default {
  async load() {
    const data = { ...defaultRelease };
    
    try {
      console.log('Fetching releases from GitHub API...');
      const response = await fetch('https://api.github.com/repos/TheFizFactor/comicers/releases/latest', {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        console.error(`GitHub API responded with status: ${response.status}`);
        data.debug = { error: `API returned ${response.status}` };
        return data;
      }

      const release = await response.json();
      console.log('GitHub release data:', JSON.stringify(release, null, 2));
      
      // Debug information
      data.debug = { 
        hasAssets: Boolean(release.assets && release.assets.length),
        assetCount: release.assets ? release.assets.length : 0,
        assetNames: release.assets ? release.assets.map((a: any) => a.name) : []
      };
      
      if (!release.assets || release.assets.length === 0) {
        console.log('No assets found in the release');
        return data;
      }

      const date = new Date(release.published_at);
      
      // Safely find assets - now more verbose and with logging
      const findAsset = (pattern: RegExp) => {
        if (!release.assets) return null;
        
        const asset = release.assets.find((asset: any) => pattern.test(asset.name));
        console.log(`Looking for asset matching ${pattern}: ${asset ? 'Found ' + asset.name : 'Not found'}`);
        return asset || null;
      };

      const assets = {
        windows: findAsset(/Comicers-Setup-.*\.exe$/i),
        mac: findAsset(/\.dmg$/i),
        linux: findAsset(/\.AppImage$/i)
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

      console.log(`Found ${validAssets.length} valid assets for download`);

      // Update the data object with consistent date format
      data.version = release.tag_name?.replace('v', '') || defaultRelease.version;
      data.releaseDateStr = formatDate(date);
      data.releaseDaysAgo = Math.round((new Date().getTime() - date.getTime()) / (1000 * 3600 * 24));
      data.assets = validAssets;

      return data;
    } catch (error) {
      console.error('Failed to load release data:', error);
      data.debug = { error: error instanceof Error ? error.message : String(error) };
      return data;
    }
  }
};