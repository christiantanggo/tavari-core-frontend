// screens/MusicV2/MusicV2DesktopDownload.jsx
// Desktop app download page for Music V2 system

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDownload, FiMonitor, FiCheckCircle, FiInfo, FiCode, FiArrowLeft, FiZap } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { useBusiness } from '../../contexts/BusinessContext';
import { useMusicV2Service } from '../../hooks/useMusicV2Service';
import MusicV2RouteGuard from '../../components/MusicV2/MusicV2RouteGuard';
import toast from 'react-hot-toast';

const MusicV2DesktopDownload = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const [currentPlatform, setCurrentPlatform] = useState('unknown');
  const [downloadLinks, setDownloadLinks] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Detect platform
    const detectPlatform = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const platform = navigator.platform.toLowerCase();
      
      if (platform.includes('win') || userAgent.includes('windows')) {
        return 'windows';
      } else if (platform.includes('mac') || userAgent.includes('mac')) {
        return 'mac';
      } else if (platform.includes('linux') || userAgent.includes('linux')) {
        return 'linux';
      }
      return 'unknown';
    };

    setCurrentPlatform(detectPlatform());
    loadDownloadLinks();
  }, []);

  const loadDownloadLinks = async () => {
    try {
      setLoading(true);
      
      // Priority: 1. Env var, 2. Supabase Storage (where file actually is), 3. GitHub, 4. Local
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseProjectId = supabaseUrl ? supabaseUrl.match(/https?:\/\/([^.]+)/)?.[1] : null;
      const supabaseStorageUrl = supabaseProjectId 
        ? `https://${supabaseProjectId}.supabase.co/storage/v1/object/public/music-installers`
        : null;
      
      const githubReleasesUrl = 'https://github.com/christiantanggo/Tavari-Music-Desktop/releases/download/v1.0.0';
      
      // Check Supabase Storage FIRST (before GitHub) since that's where the file is
      const installerBaseUrl = import.meta.env.VITE_INSTALLER_BASE_URL || 
                                supabaseStorageUrl ||  // Check Supabase BEFORE GitHub
                                githubReleasesUrl ||
                                (window.location.origin + '/installers');
      
      console.log('📦 Using installer base URL:', installerBaseUrl);
      
      // Use the same filenames as the old system (the installer auto-detects Music V2)
      let links;
      
      if (installerBaseUrl.includes('github.com')) {
        // GitHub Releases - use the actual release asset names
        links = {
          windows: `${installerBaseUrl}/Tavari-Music-Desktop-Setup-1.0.0.exe`,
          mac: `${installerBaseUrl}/Tavari-Music-Desktop-1.0.0.dmg`,
          linux: `${installerBaseUrl}/Tavari-Music-Desktop-1.0.0.AppImage`
        };
      } else {
        // Supabase Storage or other sources - use simpler names
        links = {
          windows: `${installerBaseUrl}/tavari-music-desktop-setup.exe`,
          mac: `${installerBaseUrl}/tavari-music-desktop.dmg`,
          linux: `${installerBaseUrl}/tavari-music-desktop.appimage`
        };
      }
      
      setDownloadLinks(links);
    } catch (error) {
      console.error('Error loading download links:', error);
      toast.error('Failed to load download links');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (platform) => {
    try {
      const link = downloadLinks[platform];
      if (!link) {
        toast.error(`${platform} installer not available`);
        return;
      }

      // For GitHub Releases, use direct download (CORS blocks fetch)
      // For local/Supabase, use fetch to verify
      const isGitHubRelease = link.includes('github.com') && link.includes('/releases/download/');
      
      if (isGitHubRelease) {
        // Direct download for GitHub Releases (CORS issue)
        console.log('🔍 [DOWNLOAD] Using direct download for GitHub Release');
        console.log('   URL:', link);
        
        const anchor = document.createElement('a');
        anchor.href = link;
        // Force filename for Windows
        if (platform === 'windows') {
          anchor.download = 'tavari-music-desktop-setup.exe';
        } else {
          anchor.download = ''; // Let browser determine filename
        }
        anchor.target = '_blank';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        
        console.log('   ✅ Direct download initiated');
        toast.success(`Downloading ${platform} installer...`);
        return; // Exit early
      }
      
      // Fetch file as blob for local/Supabase (can verify)
      console.log('🔍 [DOWNLOAD] Starting download for platform:', platform);
      console.log('   URL:', link);
      
      // Show progress toast
      const progressToast = toast.loading('Preparing download...');
      
      try {
        console.log('   📡 Fetching file...');
        
        // Create AbortController for timeout (5 minutes for production)
        const controller = new AbortController();
        const timeout = 300000; // 5min
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(link, {
          method: 'GET',
          headers: {
            'Accept': 'application/zip, application/octet-stream, */*'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        console.log('   📥 Response received:');
        console.log('      Status:', response.status, response.statusText);
        console.log('      Headers:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
          toast.dismiss(progressToast);
          
          // If 400/404, the file might not exist - try alternative filenames
          if (response.status === 400 || response.status === 404) {
            const errorText = await response.text();
            console.error('File not found. Response:', errorText);
            console.log('⚠️ Trying alternative filename...');
            
            // Try alternative filename with capital letters (as seen in docs)
            const altFilename = platform === 'windows' 
              ? 'Tavari-Music-Desktop-Setup.exe'
              : platform === 'mac'
              ? 'Tavari-Music-Desktop.dmg'
              : 'Tavari-Music-Desktop.AppImage';
            
            const altLink = `${link.split('/').slice(0, -1).join('/')}/${altFilename}`;
            console.log('🔄 Trying alternative URL:', altLink);
            
            try {
              const altResponse = await fetch(altLink, {
                method: 'GET',
                headers: {
                  'Accept': 'application/zip, application/octet-stream, */*'
                },
                signal: controller.signal
              });
              
              if (altResponse.ok) {
                console.log('✅ Found file with alternative filename!');
                // Retry with alternative link
                const altBlob = await altResponse.blob();
                const blobUrl = window.URL.createObjectURL(altBlob);
                const anchor = document.createElement('a');
                anchor.href = blobUrl;
                anchor.download = altFilename;
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
                setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);
                
                toast.success(`✅ Download started!`);
                return;
              }
            } catch (altError) {
              console.error('Alternative filename also failed:', altError);
            }
            
            // If both fail, show error
            toast.error(
              `Installer file not found in Supabase Storage. Please upload the installer to the 'music-installers' bucket.`,
              { duration: 10000 }
            );
            throw new Error(`File not found (${response.status}): The installer file may not be uploaded yet.`);
          }
          
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Check response details
        const contentType = response.headers.get('content-type') || '';
        const contentDisposition = response.headers.get('content-disposition') || '';
        const contentLength = response.headers.get('content-length') || 'unknown';
        const fileSizeMB = contentLength !== 'unknown' ? (parseInt(contentLength) / 1024 / 1024).toFixed(2) : 'unknown';
        
        console.log('   📋 Response details:');
        console.log('      Content-Type:', contentType);
        console.log('      Content-Disposition:', contentDisposition);
        console.log('      Content-Length:', contentLength, 'bytes');
        console.log('      File Size:', fileSizeMB, 'MB');
        
        // Update progress
        toast.loading(`Downloading... (${fileSizeMB} MB)`, { id: progressToast });
        
        console.log('   💾 Converting to blob...');
        const blob = await response.blob();
        
        const blobSizeMB = (blob.size / 1024 / 1024).toFixed(2);
        console.log('   ✅ Blob created:');
        console.log('      Type:', blob.type);
        console.log('      Size:', blob.size, 'bytes');
        console.log('      Size:', blobSizeMB, 'MB');

        // Extract filename from content-disposition or use default
        let filename = 'tavari-music-desktop-setup.exe';
        if (platform === 'windows') filename = 'tavari-music-desktop-setup.exe';
        else if (platform === 'mac') filename = 'Tavari-Music-Desktop.dmg';
        else if (platform === 'linux') filename = 'Tavari-Music-Desktop.AppImage';
        
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];

        // Skip ZIP validation for .exe files
        const isExeFile = link.toLowerCase().endsWith('.exe') || 
                          filename.toLowerCase().endsWith('.exe');
        
        if (!isExeFile) {
          // Verify it's a valid file by checking magic bytes
          console.log('   🔍 Verifying file signature...');
          const arrayBuffer = await blob.slice(0, 4).arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const magicBytes = Array.from(uint8Array).map(b => b.toString(16).padStart(2, '0')).join(' ');
          
          console.log('      Magic bytes (first 4):', magicBytes);

          if (blob.type && (blob.type.includes('text/html') || blob.type.includes('text/plain'))) {
            console.error('   ❌ Received HTML/Text instead of file!');
            const text = await blob.slice(0, 500).text();
            console.error('   First 500 chars:', text);
            toast.dismiss(progressToast);
            throw new Error('Received HTML instead of file. Check server logs. URL: ' + link);
          }
        } else {
          console.log('   ✅ Executable file detected (.exe) - skipping validation');
        }
        
        // Update progress
        toast.loading(`File ready! Starting download... (${blobSizeMB} MB)`, { id: progressToast });

        // Create download link from blob
        console.log('   📥 Creating download link...');
        const blobUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        
        anchor.download = filename;
        console.log('   💾 Filename:', filename);
        
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        
        // Clean up blob URL after a delay
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);

        console.log('   ✅ Download initiated successfully');
        toast.dismiss(progressToast);
        toast.success(`✅ Download started! (${blobSizeMB} MB)`, { duration: 3000 });
      } catch (fetchError) {
        console.error('   ❌ Fetch error:', fetchError);
        console.error('   Error stack:', fetchError.stack);
        toast.dismiss(progressToast);
        
        if (fetchError.name === 'AbortError') {
          toast.error(`Download timeout after ${timeout / 1000} seconds. File may be too large.`);
        } else {
          toast.error(`Download failed: ${fetchError.message}`);
        }
        throw fetchError;
      }
      
    } catch (error) {
      console.error('Download error:', error);
      toast.error(`Failed to download: ${error.message}`);
    }
  };

  const styles = {
    container: {
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '40px 20px',
      paddingTop: '100px', // Extra padding to account for fixed header (60px) + spacing
      fontFamily: TavariStyles.typography?.fontFamily || 'system-ui, sans-serif'
    },
    header: {
      textAlign: 'center',
      marginBottom: '50px'
    },
    title: {
      fontSize: '36px',
      fontWeight: 'bold',
      color: TavariStyles.colors.gray900,
      marginBottom: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px'
    },
    subtitle: {
      fontSize: '18px',
      color: TavariStyles.colors.gray600,
      marginBottom: '8px'
    },
    description: {
      fontSize: '16px',
      color: TavariStyles.colors.gray500,
      maxWidth: '700px',
      margin: '0 auto 40px',
      lineHeight: '1.6'
    },
    backButton: {
      marginBottom: '2rem',
      padding: '0.5rem 1rem',
      backgroundColor: '#6c757d',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem'
    },
    platformGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '24px',
      marginBottom: '40px'
    },
    platformCard: {
      background: 'white',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: '12px',
      padding: '32px',
      textAlign: 'center',
      transition: 'all 0.2s',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
    },
    platformCardRecommended: {
      border: `2px solid ${TavariStyles.colors.primary}`,
      boxShadow: `0 4px 12px ${TavariStyles.colors.primary}20`
    },
    platformIcon: {
      fontSize: '48px',
      color: TavariStyles.colors.primary,
      marginBottom: '16px'
    },
    platformName: {
      fontSize: '20px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900,
      marginBottom: '8px'
    },
    platformLabel: {
      fontSize: '14px',
      color: TavariStyles.colors.primary,
      fontWeight: '500',
      marginBottom: '16px'
    },
    downloadButton: {
      width: '100%',
      padding: '14px 24px',
      background: TavariStyles.colors.primary,
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      fontSize: '16px',
      fontWeight: '600',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      transition: 'all 0.2s',
      marginTop: '16px'
    },
    infoSection: {
      background: TavariStyles.colors.gray50,
      borderRadius: '12px',
      padding: '32px',
      marginTop: '40px'
    },
    infoTitle: {
      fontSize: '20px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900,
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    infoText: {
      fontSize: '15px',
      color: TavariStyles.colors.gray700,
      lineHeight: '1.7',
      marginBottom: '16px'
    },
    featureItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '12px',
      fontSize: '14px',
      color: TavariStyles.colors.gray700
    },
    v2Badge: {
      display: 'inline-block',
      padding: '0.25rem 0.75rem',
      backgroundColor: '#ffc107',
      color: '#000',
      borderRadius: '12px',
      fontSize: '0.875rem',
      fontWeight: 'bold',
      marginLeft: '0.5rem'
    }
  };

  const features = [
    'Music V2 with ad revenue sharing',
    'Automatic playlist scheduling',
    'CEO Rules Engine for optimization',
    'Offline caching for continuous playback',
    'Real-time schedule updates',
    'Separate music and ad volume controls',
    'Content rating filters',
    'Device management and tracking'
  ];

  const installationSteps = currentPlatform === 'windows' ? [
    'Click the Download button below',
    'Double-click the downloaded installer',
    'Follow the installation wizard',
    'Login once with your Tavari account',
    'Music V2 starts automatically with all your settings!'
  ] : currentPlatform === 'mac' ? [
    'Click the Download button below',
    'Open the downloaded .dmg file',
    'Drag the app to your Applications folder',
    'Double-click the app to launch',
    'Login once with your Tavari account',
    'Music V2 starts automatically!'
  ] : [
    'Click the Download button below',
    'Make the file executable: chmod +x Tavari-Music-Desktop-V2.AppImage',
    'Double-click to run the AppImage',
    'Login once with your Tavari account',
    'Music V2 starts automatically!'
  ];

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={styles.title}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <MusicV2RouteGuard>
      <div style={styles.container}>
        <button
          onClick={() => navigate('/dashboard/music-v2/dashboard')}
          style={styles.backButton}
        >
          <FiArrowLeft /> Back to Music V2 Dashboard
        </button>

        <div style={styles.header}>
          <h1 style={styles.title}>
            <FiZap style={{ color: '#ffc107' }} />
            Music V2 Desktop App
            <span style={styles.v2Badge}>V2</span>
          </h1>
          <p style={styles.subtitle}>Download for Mini PC, Tablet, or Computer</p>
          <p style={styles.description}>
            Install the Music V2 desktop app to run continuous background music with advanced features:
            ad revenue sharing, CEO optimization rules, offline caching, and real-time schedule updates.
            Perfect for mini PCs, tablets, and dedicated music players.
          </p>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiDownload /> Download for Your Platform
          </h2>
          
          <div style={styles.platformGrid}>
            {/* Windows */}
            <div 
              style={{
                ...styles.platformCard,
                ...(currentPlatform === 'windows' ? styles.platformCardRecommended : {})
              }}
            >
              <FiMonitor style={styles.platformIcon} />
              <div style={styles.platformName}>Windows</div>
              {currentPlatform === 'windows' && (
                <div style={styles.platformLabel}>Recommended for your device</div>
              )}
              <button
                style={styles.downloadButton}
                onClick={() => handleDownload('windows')}
                onMouseEnter={(e) => e.currentTarget.style.background = TavariStyles.colors.primaryDark}
                onMouseLeave={(e) => e.currentTarget.style.background = TavariStyles.colors.primary}
              >
                <FiDownload /> Download Music V2
              </button>
              <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '8px' }}>
                Windows 10/11 • No Admin Required
              </div>
            </div>

            {/* Mac */}
            <div 
              style={{
                ...styles.platformCard,
                ...(currentPlatform === 'mac' ? styles.platformCardRecommended : {})
              }}
            >
              <FiMonitor style={styles.platformIcon} />
              <div style={styles.platformName}>macOS</div>
              {currentPlatform === 'mac' && (
                <div style={styles.platformLabel}>Recommended for your device</div>
              )}
              <button
                style={styles.downloadButton}
                onClick={() => handleDownload('mac')}
                onMouseEnter={(e) => e.currentTarget.style.background = TavariStyles.colors.primaryDark}
                onMouseLeave={(e) => e.currentTarget.style.background = TavariStyles.colors.primary}
              >
                <FiDownload /> Download Music V2
              </button>
              <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '8px' }}>
                macOS 10.15+ • Intel & Apple Silicon
              </div>
            </div>

            {/* Linux */}
            <div 
              style={{
                ...styles.platformCard,
                ...(currentPlatform === 'linux' ? styles.platformCardRecommended : {})
              }}
            >
              <FiMonitor style={styles.platformIcon} />
              <div style={styles.platformName}>Linux</div>
              {currentPlatform === 'linux' && (
                <div style={styles.platformLabel}>Recommended for your device</div>
              )}
              <button
                style={styles.downloadButton}
                onClick={() => handleDownload('linux')}
                onMouseEnter={(e) => e.currentTarget.style.background = TavariStyles.colors.primaryDark}
                onMouseLeave={(e) => e.currentTarget.style.background = TavariStyles.colors.primary}
              >
                <FiDownload /> Download Music V2
              </button>
              <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '8px' }}>
                AppImage Format • Most Distributions
              </div>
            </div>
          </div>
        </div>

        <div style={styles.infoSection}>
          <h3 style={styles.infoTitle}>
            <FiZap style={{ color: '#ffc107' }} /> Music V2 Features
          </h3>
          <div>
            {features.map((feature, index) => (
              <div key={index} style={styles.featureItem}>
                <FiCheckCircle color={TavariStyles.colors.success} />
                {feature}
              </div>
            ))}
          </div>
        </div>

        <div style={styles.infoSection}>
          <h3 style={styles.infoTitle}>
            <FiCode /> Installation Instructions
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0' }}>
            {installationSteps.map((step, index) => (
              <li key={index} style={{ 
                display: 'flex', 
                alignItems: 'flex-start', 
                gap: '12px', 
                marginBottom: '16px',
                fontSize: '15px',
                color: TavariStyles.colors.gray700
              }}>
                <div style={{
                  background: TavariStyles.colors.primary,
                  color: 'white',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: '600',
                  flexShrink: 0
                }}>
                  {index + 1}
                </div>
                <span>{step}</span>
              </li>
            ))}
          </ul>
          
          <div style={styles.infoText}>
            <strong>Important:</strong> The desktop app automatically detects if your business has Music V2 enabled
            and will use the new system with all V2 features (ads, CEO rules, offline caching, etc.).
            If Music V2 is not enabled, it will use the classic music system.
          </div>
          
          <div style={{
            ...styles.infoText,
            backgroundColor: '#fff3cd',
            padding: '1rem',
            borderRadius: '4px',
            border: '1px solid #ffc107',
            marginTop: '1rem'
          }}>
            <strong>📥 Download Note:</strong> If clicking the download button opens GitHub instead of downloading,
            that's normal! On the GitHub page, right-click the installer file and select "Save Link As" or "Download"
            to save it to your computer.
          </div>
        </div>
      </div>
    </MusicV2RouteGuard>
  );
};

export default MusicV2DesktopDownload;

