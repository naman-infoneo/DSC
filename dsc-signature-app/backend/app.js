const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const signer = require('node-signpdf').default;
const plainAddPlaceholder = require('node-signpdf/dist/helpers/plainAddPlaceholder').default;
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors());
app.use(express.json());

// Store for uploaded certificates
const certStorage = new Map();

// Helper function to detect USB tokens (Windows example)
const detectUSBTokens = () => {
  return new Promise((resolve, reject) => {
    // This is a simplified example - actual implementation depends on your USB token type
    exec('wmic logicaldisk get size,volumename,caption', (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      
      const tokens = [];
      const lines = stdout.split('\n');
      
      lines.forEach(line => {
        if (line.includes('TOKEN') || line.includes('CERT')) {
          // Parse and identify potential certificate storage devices
          tokens.push({
            id: Math.random().toString(36),
            name: line.trim(),
            type: 'usb_token'
          });
        }
      });
      
      resolve(tokens);
    });
  });
};

// API to get available signing options
app.get('/signing-options', async (req, res) => {
  try {
    const options = {
      static: {
        available: fs.existsSync('./certificate.pfx'),
        name: 'Static Certificate (certificate.pfx)'
      },
      usb_tokens: []
    };

    // Try to detect USB tokens
    try {
      const tokens = await detectUSBTokens();
      options.usb_tokens = tokens;
    } catch (err) {
      console.log('USB token detection failed:', err.message);
    }

    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API to upload certificate from USB token
app.post('/upload-certificate', upload.single('certificate'), (req, res) => {
  try {
    const certId = Math.random().toString(36);
    const certPath = req.file.path;
    
    certStorage.set(certId, {
      path: certPath,
      originalName: req.file.originalname,
      type: 'uploaded'
    });

    res.json({ 
      certId,
      message: 'Certificate uploaded successfully',
      name: req.file.originalname
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enhanced signing endpoint
app.post('/sign', upload.single('pdf'), async (req, res) => {
  try {
    const { signingMethod, certId, password } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    const pdfBuffer = fs.readFileSync(req.file.path);
    const placeholderPdf = plainAddPlaceholder({ pdfBuffer });
    
    let p12Buffer;
    let certPassword = password || '123456'; // Default password

    // Handle different signing methods
    switch (signingMethod) {
      case 'static':
        if (!fs.existsSync('./certificate.pfx')) {
          throw new Error('Static certificate not found');
        }
        p12Buffer = fs.readFileSync('./certificate.pfx');
        break;
        
      case 'usb_token':
        if (!certId || !certStorage.has(certId)) {
          throw new Error('Certificate not found. Please upload certificate first.');
        }
        const certInfo = certStorage.get(certId);
        p12Buffer = fs.readFileSync(certInfo.path);
        break;
        
      default:
        throw new Error('Invalid signing method');
    }

    // Sign the PDF
    const signedPdf = signer.sign(placeholderPdf, p12Buffer, { 
      passphrase: certPassword 
    });

    // Cleanup
    fs.unlinkSync(req.file.path);
    if (signingMethod === 'usb_token' && certId) {
      const certInfo = certStorage.get(certId);
      if (certInfo && fs.existsSync(certInfo.path)) {
        fs.unlinkSync(certInfo.path);
      }
      certStorage.delete(certId);
    }

    res.type('application/pdf');
    res.send(signedPdf);
  } catch (err) {
    console.error('Signing error:', err);
    
    // Cleanup on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: 'Signing error: ' + err.message });
  }
});

// Cleanup endpoint for uploaded certificates
app.delete('/cleanup-certificate/:certId', (req, res) => {
  const { certId } = req.params;
  
  if (certStorage.has(certId)) {
    const certInfo = certStorage.get(certId);
    if (fs.existsSync(certInfo.path)) {
      fs.unlinkSync(certInfo.path);
    }
    certStorage.delete(certId);
    res.json({ message: 'Certificate cleaned up' });
  } else {
    res.status(404).json({ error: 'Certificate not found' });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));