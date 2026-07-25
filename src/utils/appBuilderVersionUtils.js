// Step 76: Create appBuilderVersionUtils.js
// Version management utilities

/**
 * Increment version
 * @param {string} version - Current version (semver)
 * @param {string} type - Type of increment ('major', 'minor', 'patch')
 * @returns {string} - New version
 */
export const incrementVersion = (version, type = 'patch') => {
  const parsed = parseVersion(version);
  
  switch (type) {
    case 'major':
      return `${parsed.major + 1}.0.0`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'patch':
    default:
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
};

/**
 * Compare versions
 * @param {string} version1 - First version
 * @param {string} version2 - Second version
 * @returns {number} - -1 if version1 < version2, 0 if equal, 1 if version1 > version2
 */
export const compareVersions = (version1, version2) => {
  const v1 = parseVersion(version1);
  const v2 = parseVersion(version2);

  if (v1.major !== v2.major) {
    return v1.major > v2.major ? 1 : -1;
  }
  if (v1.minor !== v2.minor) {
    return v1.minor > v2.minor ? 1 : -1;
  }
  if (v1.patch !== v2.patch) {
    return v1.patch > v2.patch ? 1 : -1;
  }
  return 0;
};

/**
 * Format version string
 * @param {string} version - Version string
 * @returns {string} - Formatted version (ensures semver format)
 */
export const formatVersion = (version) => {
  if (!version) return '1.0.0';
  
  const parts = version.split('.').map(Number).filter(n => !isNaN(n));
  while (parts.length < 3) {
    parts.push(0);
  }
  
  return parts.slice(0, 3).join('.');
};

/**
 * Parse version string
 * @param {string} version - Version string
 * @returns {Object} - {major, minor, patch}
 */
export const parseVersion = (version) => {
  if (!version) return { major: 0, minor: 0, patch: 0 };
  
  const parts = version.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
};

/**
 * Validate semantic version
 * @param {string} version - Version string
 * @returns {boolean} - True if valid semver
 */
export const validateSemVer = (version) => {
  if (!version) return false;
  
  const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  return semverRegex.test(version);
};




