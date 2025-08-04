import React, { useState, useEffect } from 'react';

function App() {
  const [pdf, setPdf] = useState(null);
  const [signingOptions, setSigningOptions] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState('static');
  const [password, setPassword] = useState('');
  const [certificate, setCertificate] = useState(null);
  const [uploadedCertId, setUploadedCertId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  // Fetch available signing options on component mount
  useEffect(() => {
    fetchSigningOptions();
  }, []);

  const fetchSigningOptions = async () => {
    try {
      const res = await fetch('http://localhost:3001/signing-options');
      const options = await res.json();
      setSigningOptions(options);
      
      // Auto-select method based on availability
      if (!options.static.available && options.usb_tokens.length === 0) {
        setSelectedMethod('usb_token');
      }
    } catch (err) {
      console.error('Failed to fetch signing options:', err);
      setStatus('Failed to load signing options');
    }
  };

  const handlePdfChange = (e) => {
    setPdf(e.target.files[0]);
    setStatus('');
  };

  const handleCertificateChange = (e) => {
    setCertificate(e.target.files[0]);
    setStatus('');
  };

  const uploadCertificate = async () => {
    if (!certificate) {
      setStatus('Please select a certificate file');
      return;
    }

    const formData = new FormData();
    formData.append('certificate', certificate);

    try {
      setLoading(true);
      const res = await fetch('http://localhost:3001/upload-certificate', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      
      if (res.ok) {
        setUploadedCertId(result.certId);
        setStatus(`Certificate uploaded: ${result.name}`);
      } else {
        setStatus(`Upload failed: ${result.error}`);
      }
    } catch (err) {
      setStatus(`Upload failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    if (!pdf) {
      setStatus('Please select a PDF file');
      return;
    }

    if (selectedMethod === 'usb_token' && !uploadedCertId) {
      setStatus('Please upload a certificate first');
      return;
    }

    if (!password) {
      setStatus('Please enter certificate password');
      return;
    }

    const formData = new FormData();
    formData.append('pdf', pdf);
    formData.append('signingMethod', selectedMethod);
    formData.append('password', password);
    
    if (uploadedCertId) {
      formData.append('certId', uploadedCertId);
    }

    try {
      setLoading(true);
      setStatus('Signing PDF...');
      
      const res = await fetch('http://localhost:3001/sign', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `signed_${pdf.name}`;
        a.click();
        window.URL.revokeObjectURL(url);
        
        setStatus('PDF signed successfully!');
        
        // Reset form
        setPdf(null);
        setCertificate(null);
        setUploadedCertId(null);
        setPassword('');
      } else {
        const error = await res.json();
        setStatus(`Signing failed: ${error.error}`);
      }
    } catch (err) {
      setStatus(`Signing failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!signingOptions) {
    return <div className="container">Loading signing options...</div>;
  }

  return (
    <div className="container">
      <h1>DSC PDF Signer</h1>
      
      {/* PDF File Selection */}
      <div className="form-group">
        <label>Select PDF to Sign:</label>
        <input 
          type="file" 
          accept="application/pdf" 
          onChange={handlePdfChange}
          disabled={loading}
        />
      </div>

      {/* Signing Method Selection */}
      <div className="form-group">
        <label>Signing Method:</label>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              value="static"
              checked={selectedMethod === 'static'}
              onChange={(e) => setSelectedMethod(e.target.value)}
              disabled={!signingOptions.static.available || loading}
            />
            Static Certificate {!signingOptions.static.available && '(Not Available)'}
          </label>
          
          <label>
            <input
              type="radio"
              value="usb_token"
              checked={selectedMethod === 'usb_token'}
              onChange={(e) => setSelectedMethod(e.target.value)}
              disabled={loading}
            />
            USB Token / Upload Certificate
          </label>
        </div>
      </div>

      {/* USB Token Certificate Upload */}
      {selectedMethod === 'usb_token' && (
        <div className="form-group">
          <label>Upload Certificate from USB Token:</label>
          <input 
            type="file" 
            accept=".pfx,.p12,.cer,.crt"
            onChange={handleCertificateChange}
            disabled={loading}
          />
          <button 
            onClick={uploadCertificate}
            disabled={!certificate || loading}
            className="btn-secondary"
          >
            Upload Certificate
          </button>
          {uploadedCertId && (
            <span className="success">✓ Certificate uploaded</span>
          )}
        </div>
      )}

      {/* Password Input */}
      <div className="form-group">
        <label>Certificate Password:</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter certificate password"
          disabled={loading}
        />
      </div>

      {/* Sign Button */}
      <button 
        onClick={handleSign} 
        disabled={!pdf || loading || (selectedMethod === 'usb_token' && !uploadedCertId)}
        className="btn-primary"
      >
        {loading ? 'Processing...' : 'Sign PDF'}
      </button>

      {/* Status Display */}
      {status && (
        <div className={`status ${status.includes('successfully') ? 'success' : status.includes('failed') ? 'error' : ''}`}>
          {status}
        </div>
      )}
    </div>
  );
}

export default App;
