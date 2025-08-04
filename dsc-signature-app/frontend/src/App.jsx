import React, { useState, useEffect } from 'react';

function App() {
  const [pdf, setPdf] = useState(null);
  const [certificates, setCertificates] = useState({ all: [], usbToken: [] });
  const [selectedCert, setSelectedCert] = useState('');
  const [password, setPassword] = useState('');
  const [useUSBToken, setUseUSBToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadCertificates();
  }, []);

  const loadCertificates = async () => {
    try {
      setLoading(true);
      setStatus('Loading certificates from Windows Certificate Store...');
      
      const response = await fetch('http://localhost:3001/windows-certificates');
      const result = await response.json();
      
      if (result.success) {
        setCertificates(result.certificates);
        setStatus(`Found ${result.certificates.all.length} certificates (${result.certificates.usbToken.length} on USB tokens)`);
      } else {
        setStatus(`Failed to load certificates: ${result.error}`);
      }
    } catch (error) {
      setStatus(`Error loading certificates: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    if (!pdf || !selectedCert) {
      setStatus('Please select a PDF file and certificate');
      return;
    }

    const formData = new FormData();
    formData.append('pdf', pdf);
    formData.append('thumbprint', selectedCert);
    formData.append('password', password);

    try {
      setLoading(true);
      setStatus('Signing PDF with Windows Certificate Store...');
      
      const response = await fetch('http://localhost:3001/sign-windows-cert', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `signed_${pdf.name}`;
        a.click();
        window.URL.revokeObjectURL(url);
        
        setStatus('PDF signed successfully!');
      } else {
        const error = await response.json();
        setStatus(`Signing failed: ${error.error}`);
      }
    } catch (error) {
      setStatus(`Signing failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const displayCerts = useUSBToken ? certificates.usbToken : certificates.all;

  return (
    <div className="container">
      <h1>Windows Certificate Store PDF Signer</h1>
      
      {/* PDF Selection */}
      <div className="form-group">
        <label>Select PDF to Sign:</label>
        <input 
          type="file" 
          accept="application/pdf" 
          onChange={(e) => setPdf(e.target.files[0])}
          disabled={loading}
        />
      </div>

      {/* Certificate Type Selection */}
      <div className="form-group">
        <label>Certificate Source:</label>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              checked={!useUSBToken}
              onChange={() => setUseUSBToken(false)}
              disabled={loading}
            />
            All Certificates
          </label>
          <label>
            <input
              type="radio"
              checked={useUSBToken}
              onChange={() => setUseUSBToken(true)}
              disabled={loading}
            />
            USB Token Only ({certificates.usbToken.length} found)
          </label>
        </div>
      </div>

      {/* Certificate Selection */}
      <div className="form-group">
        <label>Select Certificate:</label>
        <button onClick={loadCertificates} disabled={loading} className="btn-secondary">
          Refresh Certificates
        </button>
        
        {displayCerts.length > 0 ? (
          <select 
            value={selectedCert} 
            onChange={(e) => setSelectedCert(e.target.value)}
            disabled={loading}
          >
            <option value="">Select a certificate...</option>
            {displayCerts.map(cert => (
              <option key={cert.Thumbprint} value={cert.Thumbprint}>
                {cert.FriendlyName || cert.Subject} - Valid until: {new Date(cert.NotAfter).toLocaleDateString()}
              </option>
            ))}
          </select>
        ) : (
          <p>No certificates found. Make sure certificates are installed in Windows Certificate Store.</p>
        )}
      </div>

      {/* Password Input */}
      <div className="form-group">
        <label>Certificate Password (if required):</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter certificate password (leave blank if none)"
          disabled={loading}
        />
      </div>

      {/* Sign Button */}
      <button 
        onClick={handleSign} 
        disabled={!pdf || !selectedCert || loading}
        className="btn-primary"
      >
        {loading ? 'Processing...' : 'Sign PDF'}
      </button>

      {/* Status */}
      {status && (
        <div className={`status ${status.includes('successfully') ? 'success' : status.includes('failed') ? 'error' : ''}`}>
          {status}
        </div>
      )}
    </div>
  );
}

export default App;