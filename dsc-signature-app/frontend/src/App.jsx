import React, { useState, useEffect } from 'react';

function App() {
  const [pdf, setPdf] = useState(null);
  const [password, setPassword] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Import crypto library for proper RSA encryption
  useEffect(() => {
    // For RSA encryption, we need forge library
    const forgeScript = document.createElement('script');
    forgeScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/forge/1.3.1/forge.min.js';
    forgeScript.onload = () => {
      console.log('Forge library loaded successfully');
      fetchPublicKey();
    };
    document.head.appendChild(forgeScript);
  }, []);

  const fetchPublicKey = async () => {
    try {
      const response = await fetch('http://localhost:3001/public-key');
      const data = await response.json();
      setPublicKey(data.publicKey);
      console.log('Public key fetched successfully');
    } catch (error) {
      console.error('Error fetching public key:', error);
    }
  };

  // **PROPER RSA ENCRYPTION** for the original filename (for logging)
  const encryptFilename = (filename) => {
    try {
      // Wait for forge library to load
      if (typeof window.forge === 'undefined') {
        console.error('Forge library not loaded yet');
        return null;
      }

      // Convert PEM public key to forge format
      const publicKeyForge = window.forge.pki.publicKeyFromPem(publicKey);
      
      // Encrypt the filename using RSA-OAEP
      const encrypted = publicKeyForge.encrypt(filename, 'RSA-OAEP');
      
      // Convert to base64 for transmission
      return window.forge.util.encode64(encrypted);
    } catch (error) {
      console.error('Encryption error:', error);
      return null;
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setPdf(file);
  };

  const handleSign = async () => {
    if (!pdf || !password || !signerName || !signerEmail) {
      alert('Please fill all fields and select a PDF file');
      return;
    }

    if (!publicKey || typeof window.forge === 'undefined') {
      alert('Encryption library not ready yet. Please wait and try again.');
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('pdf', pdf);
      formData.append('password', password);
      formData.append('signerName', signerName);
      formData.append('signerEmail', signerEmail);

      // Encrypt ONLY the filename for logging purposes
      const encryptedFilename = encryptFilename(pdf.name);
      if (encryptedFilename) {
        formData.append('encryptedPath', encryptedFilename);
        console.log('Filename encrypted for secure logging');
      }

      const response = await fetch('http://localhost:3001/sign', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Signing failed: ${errorText}`);
      }

      const signatureLog = response.headers.get('X-Signature-Log');
      const pdfHash = response.headers.get('X-PDF-Hash');

      const blob = await response.blob();
      
      console.log('Signed PDF received:', blob);
      console.log('Signature log file:', signatureLog);
      console.log('PDF Hash:', pdfHash);

      // Download signed file
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signed_${pdf.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      alert(`PDF signed successfully!\nHash: ${pdfHash}\nLog: ${signatureLog}`);
      
      // Clear form
      setPdf(null);
      setPassword('');
      setSignerName('');
      setSignerEmail('');
      document.getElementById('file-input').value = '';

    } catch (error) {
      console.error('Signing error:', error);
      alert('Error signing PDF: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const viewLogs = async () => {
    try {
      const response = await fetch('http://localhost:3001/logs');
      const logs = await response.text();
      
      const newWindow = window.open();
      newWindow.document.write(`<pre>${logs}</pre>`);
      newWindow.document.title = 'PDF Signing Logs';
    } catch (error) {
      console.error('Error fetching logs:', error);
      alert('Error fetching logs: ' + error.message);
    }
  };

  return (
    <div style={{ padding: '20px', margin: '0 auto' }}>
      <h1>Digital Signature Certificate - PDF Signer</h1>
      
      <div style={{ marginBottom: '15px' }}>
        <label>Select PDF File:</label>
        <input 
          id="file-input"
          type="file" 
          accept="application/pdf" 
          onChange={handleFileChange}
          style={{ display: 'block', marginTop: '5px' }}
        />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label>Certificate Password:</label>
        <input 
          type="password" 
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter certificate password"
          style={{ display: 'block', marginTop: '5px', width: '100%', padding: '5px' }}
        />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label>Signer Name:</label>
        <input 
          type="text" 
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="Enter your full name"
          style={{ display: 'block', marginTop: '5px', width: '100%', padding: '5px' }}
        />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label>Signer Email:</label>
        <input 
          type="email" 
          value={signerEmail}
          onChange={(e) => setSignerEmail(e.target.value)}
          placeholder="Enter your email"
          style={{ display: 'block', marginTop: '5px', width: '100%', padding: '5px' }}
        />
      </div>

      <button 
        onClick={handleSign} 
        disabled={!pdf || !password || !signerName || !signerEmail || isLoading || !publicKey}
        style={{ 
          padding: '10px 20px', 
          marginRight: '10px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          opacity: (!pdf || !password || !signerName || !signerEmail || isLoading || !publicKey) ? 0.6 : 1
        }}
      >
        {isLoading ? 'Signing...' : 'Sign PDF'}
      </button>

      <button 
        onClick={viewLogs}
        style={{ 
          padding: '10px 20px',
          backgroundColor: '#28a745',
          color: 'white',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        View Signing Logs
      </button>

      <div style={{ marginTop: '15px', padding: '10px', background: '#f8f9fa', borderRadius: '5px', color: '#333' }}>
        <strong>Status:</strong>
        <div>Forge Library: {typeof window.forge !== 'undefined' ? '✅ Loaded' : '❌ Loading...'}</div>
        <div>Public Key: {publicKey ? '✅ Loaded' : '❌ Not loaded'}</div>
        <div>Encryption: {publicKey && typeof window.forge !== 'undefined' ? '🔒 RSA Ready' : '⏳ Waiting...'}</div>
      </div>
    </div>
  );
}

export default App;
