---
editLink: false
prev: false
next: false
---
<script setup>
import { useData } from 'vitepress'
import { ref, onMounted } from 'vue'
import VPButton from "vitepress/dist/client/theme-default/components/VPButton.vue"

const { theme } = useData()
// Initialize an empty release state that will be populated
const release = ref({
  version: '0.0.0',
  releaseDateStr: new Date().toLocaleDateString(),
  releaseDaysAgo: 0,
  assets: []
})
const loading = ref(true)
const error = ref(false)

onMounted(async () => {
  try {
    // Use the VitePress data loader pattern
    const releaseData = await import('@theme/data/release.data')
    release.value = await releaseData.default.load()
  } catch (e) {
    error.value = true
    console.error('Failed to load release data:', e)
  } finally {
    loading.value = false
  }
})
</script>

# Download
<div v-if="loading">Loading release information...</div>
<div v-else-if="error">Failed to load release information. Please try again later.</div>
<div v-else>
  <p>Comicers version {{ release.version }} was released on {{ release.releaseDateStr }} ({{ release.releaseDaysAgo }} days ago).</p>
  <table class="downloadTable" v-if="release.assets.length">
    <thead>
      <tr>
        <th>Platform</th>
        <th>Download</th>
        <th>Built</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="asset in release.assets" :key="asset.platform">
        <td>{{ asset.platform }}</td>
        <td><VPButton :href="asset.browser_download_url" :text="asset.name" theme="brand" /></td>
        <td>{{ asset.buildTimeStr }}</td>
      </tr>
    </tbody>
  </table>
  <p v-else>No downloads are currently available.</p>
  <blockquote>
    <p>Additional versions are available from the <a href="https://github.com/TheFizFactor/comicers/releases">GitHub releases page</a>.</p>
  </blockquote>
  <h2>Updating</h2>
  <p>Comicers checks for updates automatically when the client starts. You will be prompted when an update is available.</p>
  <h2>Next steps</h2>
  <p>Check the <a href="./guides/getting-started">Getting Started</a> guide.</p>
</div>
<style scoped>
.downloadTable {
  a {
    text-decoration: none;
  }
}
</style>