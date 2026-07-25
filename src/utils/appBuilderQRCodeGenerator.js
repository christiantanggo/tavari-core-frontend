// Step 77: Create appBuilderQRCodeGenerator.js
// QR code generation utilities
import QRCode from 'qrcode';

/**
 * Generate QR code
 * @param {string} data - Data to encode
 * @param {Object} options - QR code options
 * @returns {Promise<string>} - Data URL of QR code
 */
export const generateQRCode = async (data, options = {}) => {
  try {
    const defaultOptions = {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      ...options
    };

    const dataURL = await QRCode.toDataURL(data, defaultOptions);
    return dataURL;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
};

/**
 * Generate QR code data URL
 * @param {string} url - URL to encode
 * @returns {Promise<string>} - Data URL of QR code
 */
export const generateQRCodeDataURL = async (url) => {
  return await generateQRCode(url, {
    width: 300,
    margin: 2
  });
};




