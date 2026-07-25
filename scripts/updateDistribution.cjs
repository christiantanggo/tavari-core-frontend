const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class UpdateDistribution {
  constructor() {
    this.distPath = path.join(__dirname, '../dist');
    this.manifestPath = path.join(this.distPath, 'latest.yml');
  }

  generateManifest(version, fileName) {
    const filePath = path.join(this.distPath, fileName);
    const fileSize = fs.statSync(filePath).size;
    const fileHash = this.generateFileHash(filePath);
    
    const manifest = {
      version: version,
      files: [
        {
          url: fileName,
          sha512: fileHash,
          size: fileSize
        }
      ],
      path: fileName,
      sha512: fileHash,
      releaseDate: new Date().toISOString()
    };

    fs.writeFileSync(this.manifestPath, this.yamlStringify(manifest));
    console.log('Update manifest generated:', manifest);
    
    return manifest;
  }

  generateFileHash(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha512');
    hashSum.update(fileBuffer);
    return hashSum.digest('base64');
  }

  yamlStringify(obj) {
    let yaml = '';
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        yaml += `${key}:\n`;
        value.forEach(item => {
          yaml += '  - ';
          if (typeof item === 'object') {
            yaml += '\n';
            for (const [itemKey, itemValue] of Object.entries(item)) {
              yaml += `    ${itemKey}: ${itemValue}\n`;
            }
          } else {
            yaml += `${item}\n`;
          }
        });
      } else {
        yaml += `${key}: ${value}\n`;
      }
    }
    return yaml;
  }

  uploadToSupabase(manifest) {
    // In real implementation, this would upload to Supabase
    console.log('Uploading manifest to Supabase:', manifest);
    
    const updateRecord = {
      version_number: manifest.version,
      download_url: `https://updates.tavari.com/music-desktop/${manifest.path}`,
      file_size_bytes: manifest.files[0].size,
      file_hash: manifest.files[0].sha512,
      release_notes: 'Latest version with bug fixes and improvements',
      released_at: manifest.releaseDate,
      status: 'active'
    };
    
    return updateRecord;
  }
}

// Usage example
if (require.main === module) {
  const distributor = new UpdateDistribution();
  const version = process.argv[2] || '1.0.0';
  const fileName = process.argv[3] || 'Tavari Music Desktop Setup.exe';
  
  const manifest = distributor.generateManifest(version, fileName);
  const supabaseRecord = distributor.uploadToSupabase(manifest);
  
  console.log('Distribution complete:', supabaseRecord);
}

module.exports = UpdateDistribution;