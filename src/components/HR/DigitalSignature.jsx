import React, { useRef, useState, useEffect } from 'react';
import { AlertCircle, Check, X, RotateCcw, Download, Eye, EyeOff } from 'lucide-react';

const DigitalSignature = ({
  documentType = 'contract', // 'contract', 'policy', 'writeup', 'onboarding'
  documentId,
  businessId,
  userId,
  signerName,
  signerEmail,
  onSignatureComplete,
  onCancel,
  requireWitness = false,
  isReadOnly = false,
  existingSignature = null,
  className = '',
  requireConsent = false,
  consentChecked = false
}) => {
  const canvasRef = useRef(null);
  const witnessCanvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isWitnessDrawing, setIsWitnessDrawing] = useState(false);
  const [signatureData, setSignatureData] = useState('');
  const [witnessSignatureData, setWitnessSignatureData] = useState('');
  const [witnessName, setWitnessName] = useState('');
  const [showWitnessSignature, setShowWitnessSignature] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState('signature'); // 'signature', 'witness', 'complete'

  // Initialize canvas
  useEffect(() => {
    const initializeCanvas = () => {
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        // Set canvas size - use full width and fixed height for wider signature box
        const containerWidth = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 800;
        canvas.width = containerWidth;
        canvas.height = 150;
        
        // Set drawing properties
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        // Clear canvas with white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // If there's an existing signature, display it
        if (existingSignature && isReadOnly) {
          const img = new Image();
          img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          };
          img.src = existingSignature;
        }
      }
    };
    
    initializeCanvas();
    
    // Add resize handler to adjust canvas width when container resizes
    const handleResize = () => {
      initializeCanvas();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [existingSignature, isReadOnly]);

  // Initialize witness canvas
  useEffect(() => {
    const initializeWitnessCanvas = () => {
      if (witnessCanvasRef.current && requireWitness) {
        const canvas = witnessCanvasRef.current;
        const ctx = canvas.getContext('2d');
        
        const containerWidth = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 800;
        canvas.width = containerWidth;
        canvas.height = 150;
        
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    };
    
    initializeWitnessCanvas();
    
    // Add resize handler
    const handleResize = () => {
      initializeWitnessCanvas();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [requireWitness]);

  const getCanvasCoordinates = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  // Main signature canvas handlers
  const startDrawing = (e) => {
    if (isReadOnly) return;
    
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const coords = getCanvasCoordinates(e, canvas);
    
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const draw = (e) => {
    if (!isDrawing || isReadOnly) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const coords = getCanvasCoordinates(e, canvas);
    
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isReadOnly) return;
    
    setIsDrawing(false);
    const canvas = canvasRef.current;
    
    // Check if canvas has actual content (not just blank white)
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    
    // Check if there are any non-white pixels (signature was drawn)
    let hasContent = false;
    for (let i = 0; i < pixels.length; i += 4) {
      // Check RGB values - if any pixel is not white (255, 255, 255), there's content
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      // Allow for slight variations (not pure white)
      if (r < 250 || g < 250 || b < 250) {
        hasContent = true;
        break;
      }
    }
    
    if (hasContent) {
      const dataUrl = canvas.toDataURL('image/png');
      setSignatureData(dataUrl);
      setIsValid(true);
    } else {
      // No actual signature drawn - keep invalid
      setSignatureData('');
      setIsValid(false);
    }
  };

  // Witness signature canvas handlers
  const startWitnessDrawing = (e) => {
    setIsWitnessDrawing(true);
    const canvas = witnessCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const coords = getCanvasCoordinates(e, canvas);
    
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const drawWitness = (e) => {
    if (!isWitnessDrawing) return;
    
    const canvas = witnessCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const coords = getCanvasCoordinates(e, canvas);
    
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const stopWitnessDrawing = () => {
    setIsWitnessDrawing(false);
    const canvas = witnessCanvasRef.current;
    const dataUrl = canvas.toDataURL('image/png');
    setWitnessSignatureData(dataUrl);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    setSignatureData('');
    setIsValid(false);
  };

  const clearWitnessSignature = () => {
    const canvas = witnessCanvasRef.current;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    setWitnessSignatureData('');
  };

  const downloadSignature = () => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `signature_${documentType}_${new Date().getTime()}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  const handleSave = async () => {
    console.log('[DigitalSignature] handleSave called');
    console.log('[DigitalSignature] Signature data:', {
      hasSignatureData: !!signatureData,
      hasSignerName: !!signerName,
      isValid: isValid,
      requireWitness: requireWitness,
      hasWitnessName: !!witnessName,
      hasWitnessSignature: !!witnessSignatureData
    });

    if (!signatureData || !signerName || !isValid) {
      console.error('[DigitalSignature] Validation failed: Missing signature, name, or invalid');
      setError('Please provide a signature and signer name');
      return;
    }

    if (requireWitness && (!witnessName || !witnessSignatureData)) {
      console.error('[DigitalSignature] Validation failed: Missing witness signature or name');
      setError('Witness signature and name are required');
      return;
    }
    
    // Note: Digital signature consent is checked in parent component (ContractSignScreen)

    console.log('[DigitalSignature] Validation passed - Starting save process');
    setIsSaving(true);
    setError('');

    try {
      // Here you would call your API to store the signature
      // For now, we'll simulate the API call
      console.log('[DigitalSignature] Simulating API call...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const signatureRecord = {
        businessId,
        userId,
        documentType,
        documentId,
        signatureData,
        signerFullName: signerName,
        signerEmail,
        witnessName: requireWitness ? witnessName : null,
        witnessSignatureData: requireWitness ? witnessSignatureData : null,
        signedAt: new Date().toISOString(),
        ipAddress: 'client-ip', // Would be captured server-side
        metadata: {
          canvasWidth: canvasRef.current.width,
          canvasHeight: canvasRef.current.height,
          userAgent: navigator.userAgent,
          timestamp: Date.now()
        }
      };

      console.log('[DigitalSignature] Signature record created:', {
        hasSignatureData: !!signatureRecord.signatureData,
        signerFullName: signatureRecord.signerFullName,
        documentType: signatureRecord.documentType
      });
      console.log('[DigitalSignature] Calling onSignatureComplete callback...');
      console.log('[DigitalSignature] onSignatureComplete function:', typeof onSignatureComplete);
      
      if (onSignatureComplete) {
        console.log('[DigitalSignature] onSignatureComplete is defined - calling it now');
        onSignatureComplete(signatureRecord);
        console.log('[DigitalSignature] onSignatureComplete called successfully');
      } else {
        console.error('[DigitalSignature] onSignatureComplete is NOT defined!');
      }
      
      setCurrentStep('complete');
    } catch (err) {
      console.error('[DigitalSignature] Error in handleSave:', err);
      setError('Failed to save signature. Please try again.');
    } finally {
      console.log('[DigitalSignature] handleSave finally block - setting isSaving to false');
      setIsSaving(false);
    }
  };

  const proceedToWitness = () => {
    if (!signatureData) {
      setError('Please provide your signature first');
      return;
    }
    setCurrentStep('witness');
    setShowWitnessSignature(true);
  };

  if (isReadOnly && existingSignature) {
    return (
      <div className={`bg-white rounded-lg border`} style={{ padding: '20px' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold" style={{ color: '#1f2937' }}>Digital Signature</h3>
          <div className="flex items-center" style={{ color: '#10b981' }}>
            <Check className="w-5 h-5 mr-2" />
            <span className="text-sm font-medium">Signed</span>
          </div>
        </div>
        
        <div className="border-2 border-gray-200 rounded-lg" style={{ border: '2px solid #d1d5db', borderRadius: '8px', padding: '4px' }}>
          <canvas
            ref={canvasRef}
            className="w-full h-32 rounded-lg"
            style={{ touchAction: 'none', border: '1px solid #9ca3af', borderRadius: '6px' }}
          />
        </div>
        
        <div className="mt-4 text-sm text-gray-600">
          <p><strong>Signed by:</strong> {signerName}</p>
          {signerEmail && <p><strong>Email:</strong> {signerEmail}</p>}
          <p><strong>Document Type:</strong> {documentType}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg border`} style={{ padding: '20px' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold" style={{ color: '#1f2937' }}>
          {currentStep === 'signature' && 'Digital Signature Required'}
          {currentStep === 'witness' && 'Witness Signature Required'}
          {currentStep === 'complete' && 'Signature Complete'}
        </h3>
        
        <div className="flex items-center space-x-2">
          {currentStep === 'complete' ? (
            <div className="flex items-center text-green-600">
              <Check className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Complete</span>
            </div>
          ) : (
            <div className="flex items-center text-amber-600">
              <AlertCircle className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Pending</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {currentStep === 'signature' && (
        <div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>
              Full Name of Signer
            </label>
            <input
              type="text"
              value={signerName}
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
            />
          </div>

          <div className="mb-4" style={{ width: '100%' }}>
            <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>
              Please sign below
            </label>
            <div className="border-2 border-gray-300 rounded-lg bg-white relative" style={{ border: '2px solid #d1d5db', borderRadius: '8px', padding: '4px', width: '100%', minWidth: '600px' }}>
              <canvas
                ref={canvasRef}
                className="rounded-lg cursor-crosshair"
                style={{ touchAction: 'none', border: '1px solid #9ca3af', borderRadius: '6px', display: 'block', height: '150px', minHeight: '150px', width: '100%', minWidth: '592px' }}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={(e) => {
                  e.preventDefault();
                  const touch = e.touches[0];
                  const mouseEvent = new MouseEvent('mousedown', {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                  });
                  startDrawing(mouseEvent);
                }}
                onTouchMove={(e) => {
                  e.preventDefault();
                  const touch = e.touches[0];
                  const mouseEvent = new MouseEvent('mousemove', {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                  });
                  draw(mouseEvent);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  stopDrawing();
                }}
              />
              {!signatureData && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-gray-400 text-sm">Sign here</span>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="flex space-x-2" style={{ justifyContent: 'center' }}>
              <button
                onClick={clearSignature}
                style={{
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '700',
                  color: '#1f2937',
                  backgroundColor: '#ffffff',
                  border: '2px solid #008080',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: '0.2s ease'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f9fafb'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#ffffff'}
              >
                <RotateCcw className="w-4 h-4" />
                Clear
              </button>
              
              {signatureData && (
                <button
                  onClick={downloadSignature}
                  style={{
                    padding: '12px 24px',
                    fontSize: '14px',
                    fontWeight: '700',
                    color: '#1f2937',
                    backgroundColor: '#ffffff',
                    border: '2px solid #008080',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: '0.2s ease'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#f9fafb'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = '#ffffff'}
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={onCancel}
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '700',
                  color: '#1f2937',
                  backgroundColor: '#ffffff',
                  border: '2px solid #008080',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: '0.2s ease'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f9fafb'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#ffffff'}
              >
                Cancel
              </button>
              
              {requireWitness ? (
                <button
                  onClick={proceedToWitness}
                  disabled={!isValid}
                  style={{
                    width: '100%',
                    padding: '12px 24px',
                    fontSize: '14px',
                    fontWeight: '700',
                    color: '#ffffff',
                    backgroundColor: !isValid ? '#9ca3af' : '#008080',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: !isValid ? 'not-allowed' : 'pointer',
                    transition: '0.2s ease',
                    opacity: !isValid ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (isValid) e.target.style.backgroundColor = '#006666';
                  }}
                  onMouseLeave={(e) => {
                    if (isValid) e.target.style.backgroundColor = '#008080';
                  }}
                >
                  Continue to Witness
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={!isValid || !signatureData || isSaving || (requireConsent && !consentChecked)}
                  style={{
                    width: '100%',
                    padding: '12px 24px',
                    fontSize: '14px',
                    fontWeight: '700',
                    color: '#ffffff',
                    backgroundColor: (!isValid || !signatureData || isSaving || (requireConsent && !consentChecked)) ? '#9ca3af' : '#008080',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: (!isValid || !signatureData || isSaving || (requireConsent && !consentChecked)) ? 'not-allowed' : 'pointer',
                    transition: '0.2s ease',
                    opacity: (!isValid || !signatureData || isSaving || (requireConsent && !consentChecked)) ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (isValid && signatureData && !isSaving && (!requireConsent || consentChecked)) e.target.style.backgroundColor = '#006666';
                  }}
                  onMouseLeave={(e) => {
                    if (isValid && signatureData && !isSaving && (!requireConsent || consentChecked)) e.target.style.backgroundColor = '#008080';
                  }}
                >
                  {isSaving ? 'Saving...' : (requireConsent && !consentChecked) ? 'Please check consent box above' : (!signatureData || !isValid) ? 'Please sign above' : 'Complete Signature'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {currentStep === 'witness' && (
        <div>
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center">
              <Check className="w-5 h-5 text-green-600 mr-2" />
              <span className="text-sm text-green-700">Primary signature completed</span>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>
              Witness Full Name
            </label>
            <input
              type="text"
              value={witnessName}
              onChange={(e) => setWitnessName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-teal-500 focus:border-teal-500"
              placeholder="Enter witness full name"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>
              Witness Signature
            </label>
            <div className="border-2 border-gray-300 rounded-lg bg-white relative">
              <canvas
                ref={witnessCanvasRef}
                className="w-full rounded-lg cursor-crosshair"
                style={{ touchAction: 'none', height: '150px', minHeight: '150px' }}
                onMouseDown={startWitnessDrawing}
                onMouseMove={drawWitness}
                onMouseUp={stopWitnessDrawing}
                onMouseLeave={stopWitnessDrawing}
              />
              {!witnessSignatureData && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-gray-400 text-sm">Witness signature here</span>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="flex space-x-2" style={{ justifyContent: 'center' }}>
              <button
                onClick={clearWitnessSignature}
                style={{
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '700',
                  color: '#1f2937',
                  backgroundColor: '#ffffff',
                  border: '2px solid #008080',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: '0.2s ease'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f9fafb'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#ffffff'}
              >
                <RotateCcw className="w-4 h-4" />
                Clear Witness
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={() => setCurrentStep('signature')}
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '700',
                  color: '#1f2937',
                  backgroundColor: '#ffffff',
                  border: '2px solid #008080',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: '0.2s ease'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f9fafb'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#ffffff'}
              >
                Back
              </button>
              
              <button
                onClick={handleSave}
                disabled={!witnessName || !witnessSignatureData || isSaving}
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: '700',
                  color: '#ffffff',
                  backgroundColor: (!witnessName || !witnessSignatureData || isSaving) ? '#9ca3af' : '#008080',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: (!witnessName || !witnessSignatureData || isSaving) ? 'not-allowed' : 'pointer',
                  transition: '0.2s ease',
                  opacity: (!witnessName || !witnessSignatureData || isSaving) ? 0.6 : 1
                }}
                onMouseEnter={(e) => {
                  if (witnessName && witnessSignatureData && !isSaving) e.target.style.backgroundColor = '#006666';
                }}
                onMouseLeave={(e) => {
                  if (witnessName && witnessSignatureData && !isSaving) e.target.style.backgroundColor = '#008080';
                }}
              >
                {isSaving ? 'Saving...' : 'Complete Signature'}
              </button>
            </div>
          </div>
        </div>
      )}

      {currentStep === 'complete' && (
        <div style={{ textAlign: 'center' }}>
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h4 className="text-lg font-medium mb-2" style={{ color: '#1f2937' }}>Signature Complete</h4>
          <p className="text-sm mb-4" style={{ color: '#4b5563' }}>
            The {documentType} has been successfully signed and saved.
          </p>
          <button
            onClick={onCancel}
            style={{
              width: '100%',
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: '700',
              color: '#ffffff',
              backgroundColor: '#008080',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: '0.2s ease'
            }}
            onMouseEnter={(e) => e.target.style.backgroundColor = '#006666'}
            onMouseLeave={(e) => e.target.style.backgroundColor = '#008080'}
          >
            Close
          </button>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-gray-200">
        <div className="space-y-1" style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.5' }}>
          <p>• This signature is legally binding and will be stored securely</p>
          <p>• Timestamp, IP address, and device information will be recorded</p>
          <p>• The signature cannot be modified after completion</p>
        </div>
      </div>
    </div>
  );
};

export default DigitalSignature;