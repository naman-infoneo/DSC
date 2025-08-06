import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [pdf, setPdf] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [selectedCertificate, setSelectedCertificate] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Load certificates on mount and set up polling for USB changes
  useEffect(() => {
    loadCertificates();
    
    // Poll for USB token changes every 5 seconds
    const interval = setInterval(() => {
      if (!loading && !refreshing) {
        loadCertificates(true); // Silent refresh
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [loading, refreshing]);

  const loadCertificates = async (silent = false) => {
    try {
      if (!silent) {
        setRefreshing(true);
        setMessage('Scanning for certificates and USB tokens...');
      }
      
      const response = await fetch('http://localhost:3001/certificates');
      const data = await response.json();
      
      if (response.ok) {
        setCertificates(data.certificates);
        if (!silent) {
          setMessage(data.message || `Found ${data.certificates.length} certificate(s)`);
        }
        
        // Auto-select if only one certificate available
        if (data.certificates.length === 1 && !selectedCertificate) {
          setSelectedCertificate(data.certificates[0].id);
        }
      } else {
        throw new Error(data.error || 'Failed to load certificates');
      }
    } catch (error) {
      if (!silent) {
        setMessage('Error loading certificates: ' + error.message);
      }
      console.error('Certificate loading error:', error);
    } finally {
      if (!silent) {
        setRefreshing(false);
      }
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setPdf(file);
    setMessage('');
    
    if (file && file.type !== 'application/pdf') {
      setMessage('Warning: Please select a PDF file');
    }
  };

  const handleCertificateChange = (e) => {
    setSelectedCertificate(e.target.value);
    setMessage('');
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);

    // Basic password validation
    if (e.target.value.length > 0 && e.target.value.length < 4) {
      setMessage('Password should be at least 4 characters');
    } else {
      setMessage('');
    }
  };

  const handleSign = async () => {
    // Validation
    if (!pdf) {
      setMessage('Please select a PDF file');
      return;
    }

    if (!selectedCertificate) {
      setMessage('Please select a certificate');
      return;
    }

    if (!password) {
      setMessage('Please enter certificate password');
      return;
    }

    if (password.length < 4) {
      setMessage('Password must be at least 4 characters');
      return;
    }

    try {
      setLoading(true);
      setMessage('Preparing document for signing...');

      const selectedCert = certificates.find(cert => cert.id === selectedCertificate);
      
      // Show specific messages for different certificate types
      if (selectedCert.type === 'pkcs11') {
        setMessage('Connecting to USB token via PKCS#11...');
      } else if (selectedCert.type === 'smartcard') {
        setMessage('Connecting to smart card reader...');
      } else {
        setMessage('Processing with static certificate...');
      }
      
      const formData = new FormData();
      formData.append('pdf', pdf);
      formData.append('certificateId', selectedCertificate);
      formData.append('certificateType', selectedCert.type);
      formData.append('password', password);

      setMessage('Signing PDF document...');

      const response = await fetch('http://localhost:3001/sign', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Signing failed');
      }

      const blob = await response.blob();
      
      // Generate timestamped filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const originalName = pdf.name.replace('.pdf', '');
      const signedFileName = `${originalName}_signed_${timestamp}.pdf`;
      
      // Download signed file
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = signedFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setMessage(`✅ PDF signed successfully! Downloaded as: ${signedFileName}`);
      
      // Clear sensitive data
      setPassword('');
      
      // Optionally clear file selection
      // setPdf(null);
      
    } catch (error) {
      console.error('Signing error:', error);
      setMessage('❌ Signing failed: ' + error.message);
      
      // Provide specific error guidance
      if (error.message.includes('password') || error.message.includes('PIN')) {
        setMessage('❌ Invalid password/PIN. Please check your certificate password.');
      } else if (error.message.includes('token') || error.message.includes('card')) {
        setMessage('❌ Hardware token error. Please ensure your USB token/smart card is properly connected.');
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshCertificates = () => {
    loadCertificates();
  };

  const getCertificateIcon = (type) => {
    switch (type) {
      case 'pkcs11': return '🔐';
      case 'smartcard': return '💳';
      case 'static': return '📄';
      default: return '🔒';
    }
  };

  const getCertificateDescription = (cert) => {
    switch (cert.type) {
      case 'pkcs11': 
        return `Hardware Security Module (HSM) or USB Token via PKCS#11${cert.serial ? ` - Serial: ${cert.serial}` : ''}`;
      case 'smartcard': 
        return `Smart Card Reader: ${cert.reader || 'Unknown'}`;
      case 'static': 
        return 'Local certificate file (.pfx/.p12)';
      default: 
        return 'Certificate source';
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🔐 Professional DSC PDF Signing Tool</h1>
        <p>Secure PDF signing with USB tokens, smart cards, and static certificates</p>
      </header>
      
      <div className="form-section">
        <h2>📄 1. Select PDF Document</h2>
        <div className="file-input-container">
          <input 
            type="file" 
            accept="application/pdf" 
            onChange={handleFileChange}
            disabled={loading}
            id="pdf-input"
          />
          <label htmlFor="pdf-input" className="file-input-label">
            {pdf ? `Selected: ${pdf.name}` : 'Choose PDF file...'}
          </label>
        </div>
        {pdf && (
          <div className="file-info">
            <p>✅ File: {pdf.name} ({(pdf.size / 1024 / 1024).toFixed(2)} MB)</p>
          </div>
        )}
      </div>

      <div className="form-section">
        <h2>🔒 2. Choose Certificate Source</h2>
        <div className="certificate-section">
          <select 
            value={selectedCertificate} 
            onChange={handleCertificateChange}
            disabled={loading || certificates.length === 0}
            className="certificate-select"
          >
            <option value="">-- Select Certificate Source --</option>
            {certificates.map(cert => (
              <option key={cert.id} value={cert.id} style={{ color: 'black' }}>
                {getCertificateIcon(cert.type)} {cert.name}
              </option>
            ))}
          </select>
          
          <button 
            onClick={()=>refreshCertificates()} 
            disabled={loading || refreshing}
            className="refresh-btn"
            title="Refresh certificate list and scan for USB tokens"
          >
            {refreshing ? '🔄 Scanning...' : '🔄 Refresh'}
          </button>
        </div>

        {selectedCertificate && (
          <div className="certificate-info">
            {(() => {
              const cert = certificates.find(c => c.id === selectedCertificate);
              return cert ? (
                <div className="cert-details">
                  <p><strong>Selected:</strong> {getCertificateDescription(cert)}</p>
                  {cert.type !== 'static' && (
                    <div className="hardware-warning">
                      ⚠️ <strong>Hardware Token:</strong> Ensure your device is properly connected and drivers are installed
                    </div>
                  )}
                </div>
              ) : null;
            })()}
          </div>
        )}
      </div>

      <div className="form-section">
        <h2>🔑 3. Enter Certificate Password/PIN</h2>
        <div className="password-container">
          <input 
            type="password" 
            placeholder="Enter certificate password or PIN" 
            value={password}
            onChange={handlePasswordChange}
            disabled={loading}
            className="password-input"
            minLength={4}
          />
          <div className="password-hint">
            💡 This is your certificate password or smart card PIN
          </div>
        </div>
      </div>

      <div className="form-section">
        <button 
          onClick={handleSign} 
          disabled={!pdf || !selectedCertificate || !password || loading || password.length < 4}
          className={`sign-btn ${loading ? 'signing' : ''}`}
        >
          {loading ? (
            <>
              <span className="spinner"></span>
              Processing...
            </>
          ) : (
            <>
              ✍️ Sign PDF Document
            </>
          )}
        </button>
      </div>

      {message && (
        <div className={`message ${message.includes('❌') || message.toLowerCase().includes('error') ? 'error' : 
                                   message.includes('✅') ? 'success' : 'info'}`}>
          {message}
        </div>
      )}

      <div className="info-section">
        <h3>📋 Supported Certificate Types:</h3>
        <div className="cert-types">
          <div className="cert-type">
            <span className="cert-icon">🔐</span>
            <div>
              <strong>PKCS#11 USB Tokens:</strong>
              <p>Hardware security modules, eTokens, SafeNet tokens with PKCS#11 drivers</p>
            </div>
          </div>
          <div className="cert-type">
            <span className="cert-icon">💳</span>
            <div>
              <strong>Smart Cards:</strong>
              <p>PC/SC compatible smart card readers with embedded certificates</p>
            </div>
          </div>
          <div className="cert-type">
            <span className="cert-icon">📄</span>
            <div>
              <strong>Static Certificates:</strong>
              <p>Local .pfx/.p12 certificate files stored on disk</p>
            </div>
          </div>
        </div>
      </div>

      <div className="status-section">
        <h3>📊 System Status:</h3>
        <div className="status-grid">
          <div className="status-item">
            <span className="status-label">Certificates Found:</span>
            <span className="status-value">{certificates.length}</span>
          </div>
          <div className="status-item">
            <span className="status-label">USB Tokens:</span>
            <span className="status-value">
              {certificates.filter(c => c.type === 'pkcs11').length}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Smart Card Readers:</span>
            <span className="status-value">
              {certificates.filter(c => c.type === 'smartcard').length}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Static Certificates:</span>
            <span className="status-value">
              {certificates.filter(c => c.type === 'static').length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
